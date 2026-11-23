// Which hard rule of the feed removes a user's jobs (23 Nov: Nitin, 17,109 open India jobs, 208 past the rules). Each
// rule alone on the same pool (open, India or remote India, the feed's boards, posted within INGEST_DAYS, not swiped),
// then the jobs ONLY that rule removes (they pass every other rule), per board, with sample titles. Read only.
//   npx tsx scripts/feed-gates-report.ts --email <email> [--samples 12]
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db";
import { poolSql } from "../src/modules/jobs/pool";
import { feedTracks, levelsFor, SIMILARITY_FLOOR, yearsReach } from "../src/modules/jobs/match";
import { gateSql } from "../src/modules/jobs/gate";
import { tracksOf } from "../src/modules/jobs/functions";
import { profileVector } from "../src/modules/jobs/semantic";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const user = await db.user.findUnique({ where: { email: arg("--email")! }, select: { id: true } });
  const profile = await db.profile.findUnique({ where: { userId: user!.id } });
  if (!profile) throw new Error("no profile");
  const samples = Number(arg("--samples") ?? 12);
  const tracks = feedTracks(tracksOf(profile), profile.showNearby === true);
  const years = profile.yearsExperience ?? null;
  const band = { maxYears: yearsReach(years), levels: levelsFor(years) };
  const vector = await profileVector(profile);
  console.log(`user: ${years ?? "?"} years, title "${profile.currentTitle}", tracks ${JSON.stringify(tracks)}, band ${JSON.stringify(band)}, avoid ${JSON.stringify(profile.avoid)}`);

  const rules: Array<[string, Prisma.Sql]> = [
    ["years", Prisma.sql`(j."experienceMin" IS NULL OR j."experienceMin" <= ${band.maxYears}::int)`],
    ["level", Prisma.sql`(j.seniority IS NULL OR j.seniority = ANY(${band.levels}::text[]))`],
    ["field", gateSql({ tracks, avoid: profile.avoid ?? [] })],
    ["resume_closeness", vector ? Prisma.sql`(j.embedding IS NULL OR 1 - (j.embedding <=> ${vector}::halfvec) >= ${SIMILARITY_FLOOR})` : Prisma.sql`true`],
  ];
  const pool = Prisma.sql`${poolSql("j")} AND NOT EXISTS (SELECT 1 FROM "Swipe" s WHERE s."userId" = ${user!.id} AND s."jobId" = j.id)`;
  const count = async (where: Prisma.Sql) => (await db.$queryRaw<Array<{ source: string; n: number }>>`SELECT j.source, count(*)::int n FROM "Job" j WHERE ${pool} AND ${where} GROUP BY 1 ORDER BY 2 DESC`);
  const fmt = (rows: Array<{ source: string; n: number }>) => `${rows.reduce((a, r) => a + r.n, 0)} [${rows.map((r) => `${r.source} ${r.n}`).join(", ")}]`;

  console.log(`\nPOOL: ${fmt(await count(Prisma.sql`true`))}`);
  const all = Prisma.join(rules.map(([, sql]) => sql), " AND ");
  console.log(`ALL RULES: ${fmt(await count(all))}`);
  for (const [name, sql] of rules) console.log(`  ${name} alone keeps: ${fmt(await count(sql))}`);
  for (const [name, sql] of rules) {
    const others = rules.filter(([other]) => other !== name).map(([, s]) => s);
    const onlyThis = Prisma.sql`${Prisma.join(others, " AND ")} AND NOT coalesce(${sql}, false)`;
    console.log(`\nREMOVED ONLY BY ${name}: ${fmt(await count(onlyThis))}`);
    const rows = await db.$queryRaw<Array<{ source: string; title: string; track: string | null; role: string | null; reading: boolean | null; fn: string | null; exp: number | null; seniority: string | null; sim: number | null }>>`
      SELECT j.source, j.title, j.track, j."roleFamily" AS role, j."readingCurrent" AS reading, j.function AS fn, j."experienceMin" AS exp, j.seniority,
             ${vector ? Prisma.sql`(1 - (j.embedding <=> ${vector}::halfvec))::float8` : Prisma.sql`NULL::float8`} AS sim
      FROM "Job" j WHERE ${pool} AND ${onlyThis} ORDER BY random() LIMIT ${samples}`;
    for (const r of rows) console.log(`    ${r.source} | ${r.title.slice(0, 60)} | track=${r.track} role=${r.role}${r.reading ? "" : "(old)"} fn=${r.fn} exp=${r.exp} lvl=${r.seniority} sim=${r.sim?.toFixed(2)}`);
  }
}
main().finally(() => db.$disconnect());
