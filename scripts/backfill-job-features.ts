// The feed scores and filters jobs from features stored at ingest (modules/jobs/match.ts feedRows): `terms` is kept
// by a trigger, `experienceMin` and `country` by ingest. Re-run this after changing requiredYears() or the country
// rules in tagPosting() (modules/jobs/tagging.ts) so every stored value matches them again; it only writes rows
// whose value changed. npx tsx scripts/backfill-job-features.ts
import { db } from "../src/lib/db";
import { requiredYears, tagPosting } from "../src/modules/jobs/tagging";

async function main() {
  const jobs = await db.job.findMany({ select: { id: true, title: true, location: true, description: true, experienceMin: true, country: true, remoteType: true } });
  const changed = jobs
    .map((job) => {
      // Ingest knew whether the board flagged the job remote; the stored remoteType keeps that.
      const country = tagPosting({ title: job.title, location: job.location, description: job.description, isRemote: job.remoteType === "remote" }).country;
      return { id: job.id, experienceMin: requiredYears(job.title, job.description), country, was: job };
    })
    .filter((job) => job.experienceMin !== job.was.experienceMin || job.country !== job.was.country);
  const moved = new Map<string, number>();
  for (const job of changed) if (job.country !== job.was.country) moved.set(`${job.was.country} -> ${job.country}`, (moved.get(`${job.was.country} -> ${job.country}`) ?? 0) + 1);
  for (let i = 0; i < changed.length; i += 200) {
    const batch = changed.slice(i, i + 200);
    await db.$transaction(batch.map((job) => db.job.update({ where: { id: job.id }, data: { experienceMin: job.experienceMin, country: job.country } })));
  }
  console.log(`${jobs.length} jobs; ${changed.length} updated; countries ${JSON.stringify(Object.fromEntries(moved))}`);
}

main().finally(() => db.$disconnect());
