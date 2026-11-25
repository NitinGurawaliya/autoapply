// Phase U7: the share-link funnel (src/lib/funnel.ts). Writes rows under made-up visitor ids starting "v_test" for a real
// job, checks each step is kept once per visitor and job, that the table holds no personal fields, that a failing write
// returns false instead of throwing, that `submitted` follows a queued application, and the report's numbers; then
// deletes its rows.
// npx tsx scripts/share-funnel-test.ts
import { db } from "../src/lib/db";
import { funnelReport, track, trackSubmitted } from "../src/lib/funnel";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const PREFIX = `v_test${Date.now().toString(16)}`;
const visitor = (n: number) => `${PREFIX}_${n}`;

async function main() {
  const job = await db.job.findFirst({ where: { closedAt: null }, select: { id: true } });
  if (!job) throw new Error("no job");
  const since = new Date(Date.now() - 60_000);
  try {
    // Once per visitor, job and step.
    check("a step is written", await track("view", { jobId: job.id, visitorId: visitor(1), source: "li" }));
    await track("view", { jobId: job.id, visitorId: visitor(1), source: "li" });
    check("the same step again is not a second row", (await db.funnelEvent.count({ where: { visitorId: visitor(1), step: "view" } })) === 1);

    // The table's columns: nothing about the person.
    const columns = (await db.$queryRaw<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_name = 'FunnelEvent'`).map((row) => row.column_name).sort();
    check("no personal fields", columns.join() === ["at", "detail", "id", "jobId", "source", "step", "userId", "visitorId"].join(), columns.join());

    // A write that fails returns false and does not throw.
    let threw = false;
    let wrote = true;
    try {
      wrote = await track("view", { jobId: "x".repeat(10) as string, visitorId: visitor(9), detail: "\u0000" });
    } catch {
      threw = true;
    }
    check("a failing write returns false, never throws", !threw && wrote === false);
    check("no visitor and no user: nothing written", (await track("view", { jobId: job.id, visitorId: null })) === false);

    // Three visitors: li reaches queued and submitted, x stops at apply_tap, one with no source only views.
    for (const step of ["apply_tap", "signed_in", "resume_read", "profile_saved"] as const) await track(step, { jobId: job.id, visitorId: visitor(1) });
    await track("queued", { jobId: job.id, visitorId: visitor(1), detail: `${PREFIX}_app` });
    await trackSubmitted(`${PREFIX}_app`);
    check("submitted follows the queued application", (await db.funnelEvent.count({ where: { visitorId: visitor(1), step: "submitted", detail: `${PREFIX}_app` } })) === 1);
    await track("view", { jobId: job.id, visitorId: visitor(2), source: "x" });
    await track("apply_tap", { jobId: job.id, visitorId: visitor(2) });
    await track("view", { jobId: job.id, visitorId: visitor(3) });
    await trackSubmitted(`${PREFIX}_nothing`);
    check("submitted without a queued share application writes nothing", (await db.funnelEvent.count({ where: { detail: `${PREFIX}_nothing` } })) === 0);

    const report = await funnelReport(since, PREFIX);
    const row = (source: string) => report.rows.find((item) => item.source === source)?.counts;
    check("all: 3 viewed, 2 tapped, 1 queued, 1 submitted", row("all")?.view === 3 && row("all")?.apply_tap === 2 && row("all")?.queued === 1 && row("all")?.submitted === 1, JSON.stringify(row("all")));
    check("li: the one who went all the way", row("li")?.view === 1 && row("li")?.submitted === 1);
    check("x: viewed and tapped only", row("x")?.view === 1 && row("x")?.apply_tap === 1 && row("x")?.signed_in === 0);
    check("no source: counted as none", row("none")?.view === 1);
  } finally {
    await db.funnelEvent.deleteMany({ where: { visitorId: { startsWith: PREFIX } } });
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS share-funnel-test" : `FAIL share-funnel-test (${failed})`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
