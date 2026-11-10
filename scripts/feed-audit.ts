// What a user's feed shows and why: every card with its score, tier, title, the years and level it asks for, its
// track, closeness by meaning and the model's verdict, plus the pool behind it. Flags cards that miss the user's
// band, level, field or place by rules written here, apart from match.ts, so the check is not the code checking
// itself. Reads only (the model's verdicts are cached per resume as the feed does). The feed cache is per process.
// npx tsx scripts/feed-audit.ts [userId-suffix ...]   (default: every real profile)
import { db } from "../src/lib/db";
import { listFeed, parseFeedFilters, tracksOf } from "../src/modules/jobs";
import { classifyTitle } from "../src/modules/jobs/functions";
import { profileVector } from "../src/modules/jobs/semantic";
import { requiredYears } from "../src/modules/jobs/tagging";

// A level needs these years; a job may ask at most the user's whole years (a fresher: 1). Written apart from match.ts.
const LEVEL_MIN_YEARS: Record<string, number> = { intern: 0, entry: 0, mid: 2, senior: 5, staff: 6, manager: 6 };

/** Why a card is off-target for this user, or null. Independent of match.ts on purpose. */
export function offTarget(
  job: { title: string; track: string | null; seniority: string | null; requiredYears: number | null; eligibility: string },
  user: { years: number; tracks: string[] },
) {
  const why: string[] = [];
  const level = job.seniority ?? classifyTitle(job.title).seniority;
  const band = Math.max(1, Math.floor(user.years));
  if (level && LEVEL_MIN_YEARS[level] > band) why.push(`${level} title`);
  if (level === "intern" && user.years >= 3) why.push("intern role");
  const years = job.requiredYears ?? requiredYears(job.title, "");
  if (years != null && years > band) why.push(`asks ${years} yrs`);
  const track = job.track ?? classifyTitle(job.title).track;
  if (!track) why.push("not tech");
  else if (user.tracks.length > 0 && !user.tracks.includes(track) && track !== "software") why.push(`track ${track}`);
  if (!["india", "remote_india"].includes(job.eligibility)) why.push(`place ${job.eligibility}`);
  return why.length ? why.join(", ") : null;
}

async function audit(userId: string) {
  const profile = await db.profile.findUnique({ where: { userId }, include: { user: { select: { name: true } } } });
  if (!profile) return;
  const tracks = tracksOf(profile);
  const years = profile.yearsExperience ?? 0;
  console.log(`\n=== …${userId.slice(-6)} ${profile.user.name} | title ${profile.currentTitle ?? "-"} | years ${profile.yearsExperience ?? "unknown"} | tracks ${tracks.join(",") || "-"}`);
  const t0 = Date.now();
  const feed = await listFeed(userId, parseFeedFilters({}));
  const ms = Date.now() - t0;
  const ids = feed.map((job) => job.id);
  const vector = await profileVector(profile);
  const rows = ids.length
    ? await db.$queryRaw<Array<{ id: string; seniority: string | null; track: string | null; eligibility: string; experienceMin: number | null; sim: number | null }>>`
        SELECT id, seniority, track, eligibility, "experienceMin",
               CASE WHEN ${vector}::text IS NULL OR embedding IS NULL THEN NULL ELSE (1 - (embedding <=> ${vector}::halfvec))::float8 END AS sim
        FROM "Job" WHERE id = ANY(${ids}::text[])`
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const verdicts = new Map((await db.jobJudgement.findMany({ where: { profileId: profile.id, jobId: { in: ids } }, select: { jobId: true, fit: true } })).map((row) => [row.jobId, row.fit]));
  let off = 0;
  const tiers: Record<string, number> = {};
  for (const job of feed) {
    const row = byId.get(job.id);
    const flag = row ? offTarget({ title: job.title, track: row.track, seniority: row.seniority, requiredYears: row.experienceMin, eligibility: row.eligibility }, { years, tracks }) : "missing row";
    if (flag) off += 1;
    tiers[job.tier ?? "-"] = (tiers[job.tier ?? "-"] ?? 0) + 1;
    console.log(
      `${flag ? "OFF " : "    "}${String(job.score).padStart(3)} ${(job.tier ?? "-").padEnd(7)} ${job.title.slice(0, 58).padEnd(58)} | ${job.company.slice(0, 18).padEnd(18)} | yrs ${row?.experienceMin ?? "?"} lvl ${row?.seniority ?? "-"} trk ${row?.track ?? "-"} ${job.source} sim ${row?.sim?.toFixed(2) ?? "-"} llm ${verdicts.get(job.id) ?? "-"}${flag ? `  <- ${flag}` : ""}`,
    );
  }
  console.log(`cards ${feed.length} (${Object.entries(tiers).map(([tier, n]) => `${tier} ${n}`).join(", ")}), off-target ${off}, ${ms} ms`);
  return { cards: feed.length, off };
}

async function main() {
  const wanted = process.argv.slice(2);
  const profiles = await db.profile.findMany({ where: { isTest: false }, select: { userId: true }, orderBy: { userId: "asc" } });
  const ids = profiles.map((p) => p.userId).filter((id) => wanted.length === 0 || wanted.some((suffix) => id.endsWith(suffix)));
  let off = 0;
  for (const id of ids) off += (await audit(id))?.off ?? 0;
  console.log(`\n${off === 0 ? "PASS" : "FAIL"} feed-audit: ${off} off-target cards across ${ids.length} profiles`);
}

main().finally(() => db.$disconnect());
