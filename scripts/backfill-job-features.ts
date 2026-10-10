// The feed scores jobs from features stored at ingest (modules/jobs/match.ts feedRows): `terms` is kept by a trigger,
// `experienceMin` by ingest. Re-run this after changing requiredYears() (modules/jobs/tagging.ts) so every stored
// value matches it again; it only writes rows whose value changed. npx tsx scripts/backfill-job-features.ts
import { db } from "../src/lib/db";
import { requiredYears } from "../src/modules/jobs/tagging";

async function main() {
  const jobs = await db.job.findMany({ select: { id: true, title: true, description: true, experienceMin: true } });
  const changed = jobs.map((job) => ({ id: job.id, value: requiredYears(job.title, job.description), was: job.experienceMin })).filter((job) => job.value !== job.was);
  for (let i = 0; i < changed.length; i += 200) {
    const batch = changed.slice(i, i + 200);
    await db.$transaction(batch.map((job) => db.job.update({ where: { id: job.id }, data: { experienceMin: job.value } })));
  }
  console.log(`${jobs.length} jobs; experienceMin updated on ${changed.length}`);
}

main().finally(() => db.$disconnect());
