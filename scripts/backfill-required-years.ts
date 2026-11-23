// Re-reads the years each open job asks (tagging.ts requiredYears) after the 23 Nov fix ("Experience: 1–2 Years" had been
// stored as 2) and stores the lower value only where the stored one ends a range in the posting. Dry run by default; --write to store.
//   npx tsx scripts/backfill-required-years.ts [--write]
import { db } from "../src/lib/db";
import { requiredYears } from "../src/modules/jobs/tagging";

async function main() {
  const write = process.argv.includes("--write");
  const changes = new Map<string, number>();
  const samples: string[] = [];
  let cursor: string | undefined;
  let seen = 0;
  const updates: Array<{ id: string; years: number | null }> = [];
  for (;;) {
    const jobs = await db.job.findMany({ where: { closedAt: null }, select: { id: true, title: true, description: true, experienceMin: true, source: true }, orderBy: { id: "asc" }, take: 2000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (jobs.length === 0) break;
    for (const job of jobs) {
      seen += 1;
      const years = requiredYears(job.title, job.description);
      if (years === job.experienceMin) continue;
      // Only what this fix explains: a lower value, where the stored one ends a range in the posting ("1–2 years" stored
      // as 2). Other differences (older readers, other rules) are left as they are.
      const old = job.experienceMin;
      if (old == null || years == null || years >= old) continue;
      if (!new RegExp(String.raw`\d\s*(?:[-–—]|to)\s*${old}\s*(?:\+\s*)?(?:years?|yrs?)\b`, "i").test(job.description)) continue;
      const key = `${job.experienceMin ?? "none"} -> ${years ?? "none"}`;
      changes.set(key, (changes.get(key) ?? 0) + 1);
      if (samples.length < 12) samples.push(`${job.source} | ${job.title.slice(0, 50)} | ${key}`);
      updates.push({ id: job.id, years });
    }
    cursor = jobs[jobs.length - 1].id;
  }
  console.log(`open jobs read: ${seen}; changed: ${updates.length}`);
  for (const [key, n] of [...changes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${key}: ${n}`);
  for (const line of samples) console.log(`  e.g. ${line}`);
  if (!write) return console.log("dry run: nothing written (--write to store)");
  for (let i = 0; i < updates.length; i += 200) {
    await db.$transaction(updates.slice(i, i + 200).map((u) => db.job.update({ where: { id: u.id }, data: { experienceMin: u.years } })));
  }
  console.log(`stored ${updates.length}`);
}
main().finally(() => db.$disconnect());
