// How one person's feed narrows, stage by stage, in plain SQL (docs/feed/TDD.md §2, X1). Read-only: no model call, no
// write. It follows feedRows' rules (match.ts) closely enough to see where jobs go; the model's verdicts and the 65
// floor come after the last stage. npx tsx scripts/feed-funnel.ts --email <email> [--days 60]
import { db } from "../src/lib/db";
import { FEED_BOARDS, feedTracks } from "../src/modules/jobs";
import { levelsFor, yearsReach } from "../src/modules/jobs/match";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const email = arg("--email");
  if (!email) throw new Error("usage: --email <email> [--days 60]");
  const days = Number(arg("--days")) || 60;
  const user = await db.user.findUnique({ where: { email }, select: { id: true, profile: { select: { tracks: true, showNearby: true, yearsExperience: true } } } });
  if (!user?.profile) throw new Error("no such user, or no profile");
  const years = user.profile.yearsExperience;
  const tracks = feedTracks(user.profile.tracks, user.profile.showNearby) ?? [];
  const levels = levelsFor(years);
  const reach = yearsReach(years);
  const [row] = await db.$queryRaw<
    Array<{ open: number; boards_india: number; recent: number; fields: number; years_level: number; close: number; swiped: number; left: number; daily_sets_empty_7d: number }>
  >`
    WITH me AS (SELECT embedding FROM "Profile" WHERE "userId" = ${user.id}),
    j AS (
      SELECT j.source, j.eligibility, j."postedAt", j."experienceMin", j.track, j.seniority,
             (1 - (j.embedding <=> me.embedding))::float8 AS sim,
             EXISTS (SELECT 1 FROM "Swipe" s WHERE s."userId" = ${user.id} AND s."jobId" = j.id) AS swiped
      FROM "Job" j CROSS JOIN me WHERE j."closedAt" IS NULL),
    s AS (
      SELECT *,
        source = ANY(${[...FEED_BOARDS]}::text[]) AND eligibility IN ('india', 'remote_india') AS a,
        "postedAt" > now() - make_interval(days => ${days}::int) AS b,
        track = ANY(${tracks}::text[]) AS c,
        coalesce("experienceMin", 0) <= ${reach} AND (seniority IS NULL OR seniority = ANY(${levels}::text[])) AS d,
        coalesce(sim, 0) >= 0.35 AS e
      FROM j)
    SELECT count(*)::int AS open,
      count(*) FILTER (WHERE a)::int AS boards_india,
      count(*) FILTER (WHERE a AND b)::int AS recent,
      count(*) FILTER (WHERE a AND b AND c)::int AS fields,
      count(*) FILTER (WHERE a AND b AND c AND d)::int AS years_level,
      count(*) FILTER (WHERE a AND b AND c AND d AND e)::int AS close,
      count(*) FILTER (WHERE a AND b AND c AND d AND e AND swiped)::int AS swiped,
      count(*) FILTER (WHERE a AND b AND c AND d AND e AND NOT swiped)::int AS left,
      (SELECT count(*)::int FROM "DailySet" ds WHERE ds."userId" = ${user.id} AND ds.day > now() - interval '7 days' AND cardinality(ds."jobIds") = 0) AS daily_sets_empty_7d
    FROM s`;
  console.log(`profile: ${years ?? "?"} years (asks up to ${reach}), levels ${levels.join("/")}, fields ${tracks.join(", ")}`);
  console.table([
    { stage: "open jobs, any board", jobs: row.open },
    { stage: "our boards, India or remote India", jobs: row.boards_india },
    { stage: `posted in the last ${days} days`, jobs: row.recent },
    { stage: "in their fields", jobs: row.fields },
    { stage: "within their years and level", jobs: row.years_level },
    { stage: "close to the resume (0.35+)", jobs: row.close },
    { stage: "already swiped", jobs: row.swiped },
    { stage: "left for the feed (model and floor next)", jobs: row.left },
  ]);
  console.log(`daily sets empty in the last 7 days: ${row.daily_sets_empty_7d}`);
  await db.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await db.$disconnect();
  process.exit(1);
});
