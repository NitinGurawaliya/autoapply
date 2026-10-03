import { db } from "../src/lib/db";
async function main() {
  for (const id of process.argv.slice(2)) {
    const app = await db.application.findUnique({ where: { id } });
    if (!app) { console.log(id, "not found"); continue; }
    const job = await db.job.findUnique({ where: { id: app.jobId }, include: { company: true } });
    console.log("\n==", id, job?.company.name, "|", job?.title, "| status", app.status, "| attempt", app.attempt, "| error", app.error ?? "none");
    const events = await db.applicationEvent.findMany({ where: { applicationId: id }, orderBy: { createdAt: "asc" } });
    for (const e of events) console.log(" ", e.createdAt.toISOString().slice(11, 19), e.type, e.rule ?? "", e.message.slice(0, 110));
    for (const q of (app.pendingQuestions as Array<{ key: string; type: string; label: string }>) ?? []) console.log("  pending", q.key, q.type, q.label.slice(0, 80));
  }
  await db.$disconnect();
}
main();
