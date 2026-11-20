// Fills Job.experienceMin where ingest found no years (20 Nov): from the improved requiredYears() on the stored title and
// description, else from the current reading's requirement lines. Only empty values are written, and never the
// description, so no reading goes stale and nothing is re-read. Open jobs only. Prints counts; --write to write.
//   npx tsx scripts/backfill-years.ts [--write]
import { db } from "../src/lib/db";
import { requiredYears } from "../src/modules/jobs/tagging";

async function main() {
  const write = process.argv.includes("--write");
  const jobs = await db.job.findMany({
    where: { experienceMin: null, closedAt: null },
    select: { id: true, title: true, description: true, reading: true, readingCurrent: true },
  });
  const updates: Array<{ id: string; years: number; from: "description" | "reading" }> = [];
  for (const job of jobs) {
    const fromText = requiredYears(job.title, job.description);
    if (fromText != null) {
      updates.push({ id: job.id, years: fromText, from: "description" });
      continue;
    }
    const lines = job.readingCurrent ? ((job.reading as { requirements?: string[] } | null)?.requirements ?? []) : [];
    const fromReading = lines.length ? requiredYears("", lines.join(". ")) : null;
    if (fromReading != null) updates.push({ id: job.id, years: fromReading, from: "reading" });
  }
  const byYears = new Map<number, number>();
  for (const u of updates) byYears.set(u.years, (byYears.get(u.years) ?? 0) + 1);
  console.log(`open jobs with no years: ${jobs.length}; years found: ${updates.length} (description ${updates.filter((u) => u.from === "description").length}, reading ${updates.filter((u) => u.from === "reading").length})`);
  console.log(`by years asked: ${[...byYears].sort((a, b) => a[0] - b[0]).map(([y, n]) => `${y}y ${n}`).join(", ")}`);
  if (!write) return console.log("dry run: pass --write to store them");
  let written = 0;
  for (let i = 0; i < updates.length; i += 500) {
    const chunk = updates.slice(i, i + 500);
    written += await db.$executeRaw`
      UPDATE "Job" AS j SET "experienceMin" = v.years
      FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS v(id text, years int)
      WHERE j.id = v.id AND j."experienceMin" IS NULL`;
  }
  console.log(`written: ${written}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
