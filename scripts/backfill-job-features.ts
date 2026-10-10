// The feed scores and filters jobs from features stored at ingest (modules/jobs/match.ts feedRows): `terms` is kept
// by a trigger; `description`, `experienceMin`, `country` and `eligibility` by ingest. Re-run this after changing
// plainText(), requiredYears() or the rules in tagPosting() (modules/jobs) so every stored value matches them again.
// Open Greenhouse jobs get their offices from one call per company's public board (offices are not stored); it only
// writes rows whose values changed. npx tsx scripts/backfill-job-features.ts
import { db } from "../src/lib/db";
import { fetchGreenhouse } from "../src/modules/jobs/fetchers/greenhouse";
import { plainText } from "../src/modules/jobs/normalize";
import { requiredYears, tagPosting } from "../src/modules/jobs/tagging";

async function officesByJob() {
  const companies = await db.company.findMany({ where: { source: "greenhouse", active: true }, select: { id: true, slug: true } });
  const offices = new Map<string, string[]>();
  for (const company of companies) {
    try {
      for (const job of await fetchGreenhouse(company.slug)) offices.set(`${company.id}|${job.externalId}`, job.offices ?? []);
    } catch (error) {
      console.log(`  offices for ${company.slug}: ${error instanceof Error ? error.message : error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return offices;
}

async function main() {
  const offices = await officesByJob();
  const jobs = await db.job.findMany({ select: { id: true, companyId: true, externalId: true, title: true, location: true, description: true, experienceMin: true, country: true, remoteType: true, eligibility: true } });
  const changed = jobs
    .map((job) => {
      const description = plainText(job.description);
      // Ingest knew whether the board flagged the job remote; the stored remoteType keeps that.
      const tags = tagPosting({ title: job.title, location: job.location, description, isRemote: job.remoteType === "remote", offices: offices.get(`${job.companyId}|${job.externalId}`) });
      return { id: job.id, description, experienceMin: requiredYears(job.title, description), country: tags.country, eligibility: tags.eligibility, was: job };
    })
    .filter((job) => job.description !== job.was.description || job.experienceMin !== job.was.experienceMin || job.country !== job.was.country || job.eligibility !== job.was.eligibility);
  const moved = new Map<string, number>();
  for (const job of changed) if (job.country !== job.was.country) moved.set(`${job.was.country} -> ${job.country}`, (moved.get(`${job.was.country} -> ${job.country}`) ?? 0) + 1);
  for (let i = 0; i < changed.length; i += 100) {
    const batch = changed.slice(i, i + 100);
    await db.$transaction(
      batch.map((job) =>
        db.job.update({
          where: { id: job.id },
          // Only what changed: a new description fires the trigger that refreshes the job's words (terms).
          data: {
            ...(job.description !== job.was.description ? { description: job.description } : {}),
            experienceMin: job.experienceMin,
            country: job.country,
            eligibility: job.eligibility,
          },
        }),
      ),
    );
  }
  const counts = await db.job.groupBy({ by: ["source", "eligibility"], where: { closedAt: null }, _count: true });
  console.log(`${jobs.length} jobs; ${changed.length} updated (${changed.filter((job) => job.description !== job.was.description).length} descriptions cleaned); countries ${JSON.stringify(Object.fromEntries(moved))}`);
  console.log("open jobs by eligibility:", JSON.stringify(counts.map((row) => `${row.source}/${row.eligibility}: ${row._count}`)));
}

main().finally(() => db.$disconnect());
