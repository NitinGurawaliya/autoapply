// Phase P, P1: what the job readings say (modules/jobs/reading.ts). Prints the pool's totals (families, kinds, flags, the
// share with at least 2 requirement lines, the share whose family differs from the title's track), then --sample N
// random current readings with the posting's opening text, numbered for a hand check. No model calls, no writes.
//   npx tsx scripts/reading-report.ts [--sample 20] [--seed 0.42]
import { db } from "../src/lib/db";
import { trackOf } from "../src/modules/jobs/gate";
import { poolSql } from "../src/modules/jobs/pool";
import { READING_VERSION } from "../src/modules/jobs/reading";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

type Row = {
  id: string;
  title: string;
  track: string | null;
  company: string;
  opening: string;
  roleFamily: string | null;
  kind: string | null;
  flags: string[];
  reading: { summary?: string; evidence?: Array<{ for: string; line: string }>; requirements?: string[] } | null;
};

async function main() {
  const sample = Number(arg("--sample") ?? 20);
  const [totals] = await db.$queryRaw<Array<Record<string, number>>>`
    SELECT count(*)::int AS pool,
           count(*) FILTER (WHERE "readingCurrent")::int AS current,
           count(*) FILTER (WHERE "readingCurrent" AND jsonb_array_length(coalesce(reading -> 'requirements', '[]')) >= 2)::int AS two_lines,
           count(*) FILTER (WHERE "readingCurrent" AND "roleFamily" IS NULL)::int AS no_family,
           count(*) FILTER (WHERE "readingCurrent" AND "roleFamily" = 'non_tech')::int AS non_tech,
           count(*) FILTER (WHERE "readingCurrent" AND "roleFamily" IS NOT NULL AND "roleFamily" <> 'non_tech' AND "roleFamily" IS DISTINCT FROM track)::int AS other_family
    FROM "Job" j WHERE ${poolSql("j")}`;
  const pct = (n: number) => `${((100 * n) / Math.max(1, totals.current)).toFixed(1)} %`;
  console.log(`pool ${totals.pool}, read ${totals.current} (${((100 * totals.current) / Math.max(1, totals.pool)).toFixed(1)} %)`);
  console.log(`  ≥ 2 requirement lines: ${totals.two_lines} (${pct(totals.two_lines)})`);
  console.log(`  no family: ${totals.no_family} (${pct(totals.no_family)}); non_tech: ${totals.non_tech} (${pct(totals.non_tech)}); a tech family other than the title's track: ${totals.other_family} (${pct(totals.other_family)})`);
  const kinds = await db.$queryRaw<Array<{ kind: string | null; n: number }>>`
    SELECT kind, count(*)::int AS n FROM "Job" j WHERE ${poolSql("j")} AND "readingCurrent" GROUP BY kind ORDER BY n DESC`;
  console.log(`  kinds: ${kinds.map((k) => `${k.kind ?? "null"} ${k.n}`).join(", ")}`);
  const flags = await db.$queryRaw<Array<{ flag: string; n: number }>>`
    SELECT f AS flag, count(*)::int AS n FROM "Job" j, unnest(j.flags) AS f WHERE ${poolSql("j")} AND j."readingCurrent" GROUP BY f ORDER BY n DESC`;
  console.log(`  flags: ${flags.map((f) => `${f.flag} ${f.n}`).join(", ") || "none"}`);
  const families = await db.$queryRaw<Array<{ family: string | null; n: number }>>`
    SELECT "roleFamily" AS family, count(*)::int AS n FROM "Job" j WHERE ${poolSql("j")} AND "readingCurrent" GROUP BY "roleFamily" ORDER BY n DESC`;
  console.log(`  families: ${families.map((f) => `${f.family ?? "null"} ${f.n}`).join(", ")}`);
  if (sample <= 0) return;

  const seed = Number(arg("--seed") ?? Math.random().toFixed(3));
  await db.$executeRaw`SELECT setseed(${seed}::float8)`.catch(() => undefined);
  const rows = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT setseed(${seed}::float8)`;
    return tx.$queryRaw<Row[]>`
      SELECT j.id, j.title, j.track, c.name AS company, left(regexp_replace(j.description, '[[:space:]]+', ' ', 'g'), 700) AS opening,
             j."roleFamily", j.kind, j.flags, j.reading
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
      WHERE ${poolSql("j")} AND j."readingCurrent" AND (j.reading ->> 'version')::int = ${READING_VERSION}
      ORDER BY random() LIMIT ${sample}`;
  });
  console.log(`\nsample of ${rows.length} version-${READING_VERSION} readings (seed ${seed}): for each, is the family, kind and flags right, and are the requirement lines real requirements?\n`);
  rows.forEach((row, i) => {
    const gate = trackOf({ source: "x", title: row.title, track: row.track, roleFamily: row.roleFamily, kind: row.kind, flags: row.flags, readingCurrent: true });
    console.log(`${i + 1}. ${row.title} — ${row.company}  [${row.id}]`);
    console.log(`   title track: ${row.track ?? "none"} | reading: ${row.roleFamily ?? "null"} · ${row.kind ?? "null"}${row.flags.length ? ` · ${row.flags.join(", ")}` : ""} | trackOf: ${gate}`);
    console.log(`   summary: ${row.reading?.summary ?? ""}`);
    for (const item of row.reading?.evidence ?? []) console.log(`   evidence (${item.for}): "${item.line}"`);
    (row.reading?.requirements ?? []).forEach((line, n) => console.log(`   requirement ${n + 1}: "${line}"`));
    console.log(`   opening: ${row.opening}\n`);
  });
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
