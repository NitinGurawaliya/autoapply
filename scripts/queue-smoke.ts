// Cancel, the database submit lock (including across two processes), and the stale-run reaper.
// No browser and no worker needed. npx tsx scripts/queue-smoke.ts
import { spawn } from "node:child_process";
import { db } from "../src/lib/db";
import { CancelledError, codeRequester, runApplication } from "../src/modules/apply/runner";
import { LockStopped, withSubmitLock } from "../src/modules/apply/submitLock";
import { reapStaleRuns, STALE_AFTER_SUBMIT } from "../src/worker/reaper";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const FAST = { leaseSeconds: 5, heartbeatMs: 500, pollMs: 100 };
const run = Date.now();

async function main() {
  const lockUsers: string[] = [];
  const userId = (label: string) => {
    const id = `locktest-${label}-${run}`;
    lockUsers.push(id);
    return id;
  };

  // 1. Same user: one at a time, in order. Different users: in parallel. A failed submit frees the lock.
  const log: string[] = [];
  const task = (label: string, ms = 300) => async () => {
    log.push(`start ${label}`);
    await sleep(ms);
    log.push(`end ${label}`);
  };
  const waited: string[] = [];
  const same = userId("same");
  const t0 = Date.now();
  await Promise.all([
    ...["a1", "a2", "a3"].map((label, index) =>
      sleep(index * 300).then(() => withSubmitLock(same, label, { onWait: async () => void waited.push(label) }, task(label, 3000), FAST)),
    ),
  ]);
  // Not first-come-first-served (whoever polls first after a release wins), but never two at once.
  const exclusive = log.length === 6 && [0, 2, 4].every((i) => log[i].startsWith("start ") && log[i + 1] === `end ${log[i].slice(6)}`);
  check("same user runs one at a time", exclusive, log.join(" "));
  check("the two that had to wait were told so", waited.length === 2, waited.join(","));
  check("same user took at least the sum of the tasks", Date.now() - t0 >= 8800, `${Date.now() - t0} ms`);
  const tSingle = Date.now();
  await withSubmitLock(userId("solo"), "z", {}, task("z", 1500), FAST);
  const single = Date.now() - tSingle;
  const t1 = Date.now();
  await Promise.all([withSubmitLock(userId("p1"), "x", {}, task("x", 1500), FAST), withSubmitLock(userId("p2"), "y", {}, task("y", 1500), FAST)]);
  const both = Date.now() - t1;
  check("different users run in parallel (a second task adds far less than its own 1500 ms)", both < single + 1000, `two at once ${both} ms vs one alone ${single} ms`);
  const tBase = Date.now();
  await withSubmitLock(userId("base"), "base", {}, task("base", 50), FAST);
  const baseline = Date.now() - tBase; // one uncontended acquire, 50 ms of work and a release, on this database
  const boom = userId("boom");
  let threw = false;
  try {
    await withSubmitLock(boom, "b1", {}, async () => { throw new Error("boom"); }, FAST);
  } catch {
    threw = true;
  }
  const t2 = Date.now();
  await withSubmitLock(boom, "b2", {}, task("after-error", 50), FAST);
  check("a failed submit releases the lock", threw && Date.now() - t2 < baseline * 2 + 500, `${Date.now() - t2} ms vs ${baseline} ms uncontended`);

  // 2. The lease is renewed while a holder works, so a slow holder is not pushed out.
  const slow = userId("slow");
  let secondStarted = 0;
  let firstEnded = 0;
  await Promise.all([
    withSubmitLock(slow, "s1", {}, async () => { await sleep(3500); firstEnded = Date.now(); }, { leaseSeconds: 2, heartbeatMs: 400, pollMs: 100 }),
    sleep(300).then(() => withSubmitLock(slow, "s2", {}, async () => { secondStarted = Date.now(); }, { leaseSeconds: 2, heartbeatMs: 400, pollMs: 100 })),
  ]);
  check("a holder working longer than the lease keeps the lock", secondStarted >= firstEnded && firstEnded > 0, `second started ${secondStarted - firstEnded} ms after first ended`);

  // 3. A holder that died (lease in the past) is taken over at once.
  const dead = userId("dead");
  await db.$executeRaw`INSERT INTO "SubmitLock" ("userId", "holderId", "expiresAt") VALUES (${dead}, 'ghost', now() - interval '1 minute')`;
  const t3 = Date.now();
  await withSubmitLock(dead, "alive", {}, async () => undefined, FAST);
  check("a dead holder's expired lock is taken over", Date.now() - t3 < 1000, `${Date.now() - t3} ms`);

  // 4. Waiting can be cancelled.
  const busy = userId("busy");
  let stopped = false;
  await withSubmitLock(busy, "holder", {}, async () => {
    try {
      await withSubmitLock(busy, "waiter", { shouldStop: async () => true }, async () => undefined, FAST);
    } catch (error) {
      stopped = error instanceof LockStopped;
    }
  }, FAST);
  check("a waiter that is told to stop leaves without the lock", stopped);

  // 5. Two real processes: the lock holds across them.
  const across = userId("across");
  const child = spawn("npx", ["tsx", "scripts/lock-child.ts", across, "child", "2500"], { shell: true });
  let childOut = "";
  child.stdout.on("data", (chunk) => (childOut += String(chunk)));
  const childStarted = await (async () => {
    for (let i = 0; i < 100; i += 1) {
      const m = childOut.match(/START (\d+)/);
      if (m) return Number(m[1]);
      await sleep(200);
    }
    return 0;
  })();
  let mineStarted = 0;
  if (childStarted) await withSubmitLock(across, "parent", {}, async () => { mineStarted = Date.now(); }, FAST);
  await new Promise((resolve) => (child.exitCode !== null ? resolve(null) : child.on("exit", resolve)));
  const childEnded = Number(childOut.match(/END (\d+)/)?.[1] ?? 0);
  check("the lock holds across two processes", childStarted > 0 && childEnded > 0 && mineStarted >= childEnded, `parent started ${mineStarted - childEnded} ms after the other process ended`);

  // 6. Cancel: a run waiting for a security code stops within a few seconds and stays cancelled.
  const user = await db.user.findUnique({ where: { email: "t12-check@swipeapply.local" } });
  const job = await db.job.findUnique({ where: { source_externalId: { source: "mock", externalId: "greenhouse" } } });
  if (!user || !job) throw new Error("test user or mock job missing");
  const created: string[] = [];
  const makeApp = async (data: Record<string, unknown>) => {
    const app = await db.application.create({ data: { userId: user.id, jobId: job.id, status: "filling", fields: [], pendingQuestions: [], ...data } as never });
    created.push(app.id);
    return app;
  };
  const jobIdsToClean: string[] = [];
  try {
    const app = await makeApp({});
    const waiting = codeRequester(app.id)("Enter the code").then(() => "returned", (error) => (error instanceof CancelledError ? "cancelled" : "other error"));
    await sleep(1500);
    check("run is waiting for a code", (await db.application.findUnique({ where: { id: app.id } }))?.status === "needs_input");
    await db.application.update({ where: { id: app.id }, data: { status: "cancelled", error: "Cancelled: test" } });
    const outcome = await Promise.race([waiting, sleep(8000).then(() => "still waiting")]);
    check("cancel stops the code wait", outcome === "cancelled", String(outcome));
    const after = await db.application.findUnique({ where: { id: app.id } });
    check("cancelled status is not overwritten", after?.status === "cancelled" && after.error === "Cancelled: test");
    await runApplication(app.id);
    const rerun = await db.application.findUnique({ where: { id: app.id } });
    check("re-running a cancelled application changes nothing", rerun?.status === "cancelled" && rerun.attempt === 0);

    // 7. Reaper: a dead run (active queue job, stale heartbeat) is picked up again when nothing was sent, and failed
    // when it had reached the submit check.
    const old = new Date(Date.now() - 10 * 60 * 1000);
    const deadApp = await makeApp({ status: "filling", heartbeatAt: old });
    const submittedApp = await makeApp({ status: "filling", heartbeatAt: old });
    const liveApp = await makeApp({ status: "filling", heartbeatAt: new Date() });
    const idleApp = await makeApp({ status: "needs_input", heartbeatAt: old }); // waiting for answers: no active job, must stay
    // Answered after the check before the run, minutes later: re-queued with its old heartbeat, its new job just started.
    const resumedApp = await makeApp({ status: "queued", heartbeatAt: old });
    const addActive = async (applicationId: string, startedAt: Date) => {
      const rows = await db.$queryRaw<Array<{ id: string }>>`
        INSERT INTO pgboss.job (name, data, state, started_on) VALUES ('apply', ${JSON.stringify({ applicationId })}::jsonb, 'active', ${startedAt}) RETURNING id::text AS id`;
      jobIdsToClean.push(rows[0].id);
      return rows[0].id;
    };
    const deadJob = await addActive(deadApp.id, old);
    await addActive(submittedApp.id, old);
    await db.applicationEvent.create({ data: { applicationId: submittedApp.id, type: "rule_check", rule: "submit", message: "submit passed" } });
    await addActive(liveApp.id, old);
    await addActive(resumedApp.id, new Date());
    await db.$executeRaw`INSERT INTO "SubmitLock" ("userId", "holderId", "expiresAt") VALUES (${userId("reap")}, ${deadApp.id}, now() + interval '1 minute')`;
    const reaped = await reapStaleRuns();
    const [d, l, i, r, s] = await Promise.all([deadApp, liveApp, idleApp, resumedApp, submittedApp].map((a) => db.application.findUnique({ where: { id: a.id } })));
    const requeued = await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pgboss.job WHERE name = 'apply' AND state <> 'cancelled' AND data->>'applicationId' = ${deadApp.id}`; // a running worker may already have taken it
    const jobState = await db.$queryRaw<Array<{ state: string }>>`SELECT state FROM pgboss.job WHERE id = ${deadJob}::uuid`;
    const lockLeft = await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "SubmitLock" WHERE "holderId" = ${deadApp.id}`;
    check("reaper picks up again a run cut off before Submit (nothing was sent)", d?.status === "queued" && Number(requeued[0].n) === 1, `${d?.status}; queued jobs ${requeued[0].n}; reaped ${reaped}`);
    check("reaper fails a run cut off after the submit check, saying it may have been sent", s?.status === "failed" && s.error === STALE_AFTER_SUBMIT, `${s?.status}: ${s?.error}`);
    check("reaper cancels that run's queue job", jobState[0]?.state === "cancelled", jobState[0]?.state);
    check("reaper frees that run's submit lock", Number(lockLeft[0].n) === 0);
    check("reaper leaves a run with a fresh heartbeat alone", l?.status === "filling");
    check("reaper leaves an application waiting for answers alone", i?.status === "needs_input");
    check("reaper leaves a run that just resumed (old heartbeat, new job) alone", r?.status === "queued", r?.status);
  } finally {
    if (jobIdsToClean.length) await db.$executeRaw`DELETE FROM pgboss.job WHERE id::text = ANY(${jobIdsToClean})`;
    // Runs the reaper queued again: never left for a worker to pick up.
    await db.$executeRaw`DELETE FROM pgboss.job WHERE name = 'apply' AND data->>'applicationId' = ANY(${created})`;
    await db.applicationEvent.deleteMany({ where: { applicationId: { in: created } } });
    await db.application.deleteMany({ where: { id: { in: created } } });
    await db.$executeRaw`DELETE FROM "SubmitLock" WHERE "userId" = ANY(${lockUsers})`;
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS queue smoke" : `FAIL queue smoke (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.log("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
});
