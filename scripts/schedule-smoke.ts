// Scheduled ingest: the worker registers the cron and logs it, registering twice is harmless, and cron really fires.
// Starts a real worker process for a moment. The firing check uses a throwaway every-minute schedule on a test queue
// (takes up to about two minutes). npx tsx scripts/schedule-smoke.ts
import { spawn, execSync } from "node:child_process";
import { getBoss } from "../src/lib/queue";
import { db } from "../src/lib/db";
import { DEFAULT_INGEST_CRON, DEFAULT_INGEST_DAYS, registerSchedules } from "../src/worker/schedule";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // 1. A real worker process registers the schedule and says so in its log.
  let out = "";
  const worker = spawn("npx", ["tsx", "src/worker/index.ts"], { shell: true, env: { ...process.env, DEMO_HEADED: "0" } });
  worker.stdout.on("data", (chunk) => (out += String(chunk)));
  worker.stderr.on("data", (chunk) => (out += String(chunk)));
  for (let i = 0; i < 90 && !/ingest scheduled/.test(out); i += 1) await sleep(1000);
  try {
    if (worker.pid) execSync(`taskkill /PID ${worker.pid} /T /F`, { stdio: "ignore" });
  } catch {
    // Already gone.
  }
  const line = out.split(/\r?\n/).find((l) => /ingest scheduled/.test(l)) ?? "";
  // The values come from src/worker/schedule.ts, so a schedule change does not break this check (16 Oct: it still
  // expected the old "every 6 hours, last 7 days").
  check("the worker logs the ingest schedule", line.includes(`ingest scheduled: "${DEFAULT_INGEST_CRON}" UTC, last ${DEFAULT_INGEST_DAYS} days`), line.trim());

  const boss = await getBoss();
  const stored = await boss.getSchedule("ingest");
  check(`the schedule is stored in the database as "${DEFAULT_INGEST_CRON}", UTC`, stored?.cron === DEFAULT_INGEST_CRON && stored.timezone === "UTC", `${stored?.cron} ${stored?.timezone}`);
  check("it carries the lookback window", (stored?.data as { days?: number } | undefined)?.days === DEFAULT_INGEST_DAYS);
  check("a missed run catches up once", stored?.options?.missed === "once");

  // 2. Registering again (a second worker, a restart) changes nothing.
  await registerSchedules(boss);
  await registerSchedules(boss);
  const all = (await boss.getSchedules()).filter((s) => s.name === "ingest");
  check("registering again keeps exactly one schedule", all.length === 1, `${all.length}`);

  // 3. Cron really fires here: a throwaway every-minute schedule on its own queue.
  const queue = `schedule-smoke-${Date.now()}`;
  await boss.createQueue(queue);
  let fired = 0;
  await boss.work(queue, async () => {
    fired += 1;
  });
  await boss.schedule(queue, "* * * * *", { probe: true }, { tz: "UTC" });
  const t0 = Date.now();
  while (fired === 0 && Date.now() - t0 < 150_000) await sleep(2000);
  check("a cron schedule creates a job and a worker runs it", fired >= 1, `${Math.round((Date.now() - t0) / 1000)} s`);
  await boss.unschedule(queue);
  await boss.deleteQueue(queue).catch(() => undefined);
  check("the throwaway schedule is removed", (await boss.getSchedules(queue)).length === 0);

  await boss.stop({ graceful: false }).catch(() => undefined);
  await db.$disconnect();
  console.log(failed === 0 ? "PASS schedule" : `FAIL schedule (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.log("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
});
