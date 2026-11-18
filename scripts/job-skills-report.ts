// Phase M3: job skills and their required labels, counted, sampled for a hand check, or labelled in bulk.
//   npx tsx scripts/job-skills-report.ts                 counts only
//   npx tsx scripts/job-skills-report.ts --sample 20     labels 20 open India jobs live and prints each skill in context
//   npx tsx scripts/job-skills-report.ts --label 5000    labels up to 5,000 pending jobs (labelPendingSkills)
// Prints counts and short snippets of public postings; no profile data.
import { db } from "../src/lib/db";
import { labelPendingSkills, skillLevelsBatch } from "../src/modules/jobs/semantic";
import { decodeEntities, termPositions } from "../src/modules/jobs/skills";

const arg = (name: string) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? Number(process.argv[at + 1]) : null;
};

/** Where the matcher found this skill, [bracketed], with 45 characters either side. */
function context(text: string, skill: string) {
  const hit = termPositions(text).find((item) => item.term === skill);
  if (!hit) return "(not found!)";
  const decoded = decodeEntities(text);
  return `${decoded.slice(Math.max(0, hit.at - 45), hit.at)}[${decoded.slice(hit.at, hit.end)}]${decoded.slice(hit.end, hit.end + 45)}`.replace(/\s+/g, " ");
}

async function counts() {
  const [row] = await db.$queryRaw<Array<{ open: bigint; india: bigint; with_skills: bigint; india_with: bigint; labelled: bigint; india_labelled: bigint }>>`
    SELECT count(*) AS open,
      count(*) FILTER (WHERE eligibility IN ('india', 'remote_india')) AS india,
      count(*) FILTER (WHERE cardinality(skills) > 0) AS with_skills,
      count(*) FILTER (WHERE cardinality(skills) > 0 AND eligibility IN ('india', 'remote_india')) AS india_with,
      count(*) FILTER (WHERE "skillsHash" = COALESCE("contentHash", 'none')) AS labelled,
      count(*) FILTER (WHERE "skillsHash" = COALESCE("contentHash", 'none') AND eligibility IN ('india', 'remote_india')) AS india_labelled
    FROM "Job" WHERE "closedAt" IS NULL AND source <> 'mock'`;
  console.log(`open ${row.open} (India ${row.india}); with skills ${row.with_skills} (India ${row.india_with}); labelled ${row.labelled} (India ${row.india_labelled})`);
}

async function sample(size: number) {
  const jobs = await db.$queryRaw<Array<{ id: string; title: string; company: string; description: string; skills: string[] }>>`
    SELECT j.id, j.title, c.name AS company, j.description, j.skills FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
    WHERE j."closedAt" IS NULL AND j.eligibility IN ('india', 'remote_india') AND j.function IN ('engineering', 'data_ai') AND cardinality(j.skills) >= 3
    ORDER BY md5(j.id) LIMIT ${size}`;
  const started = Date.now();
  const labels = new Map<number, string[]>();
  for (let i = 0; i < jobs.length; i += 10) {
    const batch = jobs.slice(i, i + 10);
    for (const [n, required] of await skillLevelsBatch(batch)) labels.set(i + n, required);
  }
  const chars = jobs.reduce((sum, job) => sum + Math.min(3000, job.description.length) + job.title.length + 30 * job.skills.length, 0);
  let subset = 0;
  jobs.forEach((job, n) => {
    const required = labels.get(n);
    if (required && required.every((skill) => job.skills.includes(skill))) subset += 1;
    console.log(`\n#${n + 1} ${job.title} @ ${job.company}${required ? "" : "  (no label returned)"}`);
    for (const skill of job.skills) console.log(`  ${required?.includes(skill) ? "REQ " : "    "}${skill.padEnd(22)} …${context(`${job.title}\n${job.description}`, skill)}…`);
  });
  console.log(`\nlabelled ${labels.size}/${jobs.length}; required ⊆ skills on ${subset}/${labels.size}; ${((Date.now() - started) / 1000).toFixed(1)} s; ~${Math.round(chars / 4 / jobs.length)} input tokens a job (~${((chars / 4 / jobs.length) * 1000 * 0.15) / 1e6} USD per 1,000 jobs at gpt-4o-mini input price)`);
}

async function main() {
  await counts();
  const size = arg("--sample");
  if (size) await sample(size);
  const label = arg("--label");
  if (label) {
    const started = Date.now();
    const result = await labelPendingSkills(label);
    console.log(`labelled ${result.labelled}, failed ${result.failed}, ${Math.round((Date.now() - started) / 1000)} s`);
    await counts();
  }
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
