// Queues N mock applications at once and checks their runs overlap in time. Needs the worker running.
// npx tsx scripts/concurrency-smoke.ts [N]
import { db } from "../src/lib/db";
import { enqueueApply } from "../src/lib/queue";

async function main() {
  const n = Number(process.argv[2]) || 4;
  const user = await db.user.findUnique({ where: { email: "t12-check@swipeapply.local" } });
  const job = await db.job.findUnique({ where: { source_externalId: { source: "mock", externalId: "greenhouse" } } });
  if (!user || !job) throw new Error("test user or mock job missing");
  await db.answer.upsert({
    where: { userId_key: { userId: user.id, key: "notice_period" } },
    create: { userId: user.id, key: "notice_period", question: "notice_period", answer: "30", source: "user" },
    update: {},
  });
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const app = await db.application.create({ data: { userId: user.id, jobId: job.id, status: "queued", fields: [], pendingQuestions: [] } });
    ids.push(app.id);
  }
  const t0 = Date.now();
  for (const id of ids) await enqueueApply(id);
  console.log(`queued ${n} applications`);
  const deadline = Date.now() + 240_000;
  let rows = await db.application.findMany({ where: { id: { in: ids } } });
  while (Date.now() < deadline && rows.some((r) => !["submitted", "failed", "blocked"].includes(r.status))) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    rows = await db.application.findMany({ where: { id: { in: ids } } });
  }
  const spans: Array<{ start: number; end: number }> = [];
  for (const id of ids) {
    const events = await db.applicationEvent.findMany({ where: { applicationId: id }, orderBy: { createdAt: "asc" } });
    const start = events.find((e) => e.rule === "start")?.createdAt.getTime();
    const end = events.at(-1)?.createdAt.getTime();
    if (start && end) spans.push({ start, end });
  }
  for (const r of rows) if (r.error) console.log(`error: ${r.status} ${r.error.slice(0, 200)}`);
  const sumOfRuns = spans.reduce((total, s) => total + (s.end - s.start), 0);
  const wall = Math.max(...spans.map((s) => s.end)) - Math.min(...spans.map((s) => s.start));
  let overlap = 0;
  for (let a = 0; a < spans.length; a += 1) for (let b = a + 1; b < spans.length; b += 1) if (spans[a].start < spans[b].end && spans[b].start < spans[a].end) overlap += 1;
  console.log(`statuses: ${rows.map((r) => r.status).join(", ")}`);
  console.log(`sum of run times ${(sumOfRuns / 1000).toFixed(0)}s, wall clock ${(wall / 1000).toFixed(0)}s, overlapping pairs ${overlap}, total ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const ok = rows.every((r) => r.status === "submitted") && overlap > 0 && wall < sumOfRuns * 0.8;
  console.log(ok ? "PASS runs overlap" : "FAIL runs did not overlap");
  await db.applicationEvent.deleteMany({ where: { applicationId: { in: ids } } });
  await db.application.deleteMany({ where: { id: { in: ids } } });
  process.exit(0);
}
main().catch((e) => { console.log("FAIL", e instanceof Error ? e.message : e); process.exit(1); });
