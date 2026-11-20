// Phase M2: fill Job.skills (modules/jobs/skills.ts jobSkills) on every open job, and again after a change to the
// vocabulary. Writes only rows whose list changed, 500 per statement, and clears their required labels (skillsHash) so
// labelPendingSkills labels the new list (20 Nov: a new platform term was never required under the old labels). npx tsx scripts/backfill-job-skills.ts [--all]
import { db } from "../src/lib/db";
import { jobSkills } from "../src/modules/jobs/skills";

const BATCH = 500;

async function main() {
  const all = process.argv.includes("--all");
  const where = all ? {} : { closedAt: null };
  const total = await db.job.count({ where });
  let cursor: string | undefined;
  let seen = 0;
  let written = 0;
  let withSkills = 0;
  let terms = 0;
  const started = Date.now();
  for (;;) {
    const rows = await db.job.findMany({
      where,
      select: { id: true, title: true, description: true, skills: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    seen += rows.length;
    const changed: Record<string, string[]> = {};
    for (const row of rows) {
      const skills = jobSkills(row.title, row.description);
      if (skills.length > 0) withSkills += 1;
      terms += skills.length;
      if (skills.join("\n") !== row.skills.join("\n")) changed[row.id] = skills;
    }
    const count = Object.keys(changed).length;
    if (count > 0) {
      await db.$executeRaw`
        UPDATE "Job" AS j SET "skills" = ARRAY(SELECT jsonb_array_elements_text(v.s)), "skillsHash" = NULL
        FROM jsonb_each(${JSON.stringify(changed)}::jsonb) AS v(id, s)
        WHERE j.id = v.id`;
      written += count;
    }
    if (seen % 5000 < BATCH) console.log(`  ${seen}/${total} read, ${written} written (${Math.round((Date.now() - started) / 1000)} s)`);
  }
  console.log(`backfill-job-skills: ${seen} jobs read, ${written} written, ${withSkills} with skills (${Math.round((100 * withSkills) / Math.max(1, seen))} %), ${(terms / Math.max(1, withSkills)).toFixed(1)} terms each on average`);
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
