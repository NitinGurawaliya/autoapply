import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { sendPush } from "@/lib/push";
import { tracksOf } from "./functions";
import { readingGateOn } from "./gate";
import { feedTracks, type FeedFilters, type FeedJob, type FeedPool, parseFeedFilters, rankedFeed } from "./match";
import { judgeFromHash } from "./semantic";

/**
 * The daily set (Phase P, P7, docs/relevance/TDD.md 4.1 item 8; ARCHITECTURE 6.3). Once per user per India day the top
 * DAILY_SET_SIZE unswiped jobs of the default feed are stored in `DailySet` and released DAILY_RELEASE at a time; after
 * the set the deck goes on with the ranked list. Behind `DAILY_SET=1`, on every process at once.
 */
export function dailySetOn() {
  return process.env.DAILY_SET === "1";
}

function envInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
export const setSize = () => envInt("DAILY_SET_SIZE", 12);
// The whole set at once since Phase R (owner, 20 Nov: "just show today's jobs"); DAILY_RELEASE still releases it in batches.
export const releaseSize = () => envInt("DAILY_RELEASE", setSize());
const pushHour = () => envInt("DAILY_PUSH_HOUR_IST", 8);

/** The set serves only the default view: no filter in the URL, not the skipped jobs, not "Keep going". */
export function isDefaultFeed(filters: FeedFilters) {
  return JSON.stringify(filters) === JSON.stringify(parseFeedFilters({}));
}

/** What the agent did for a set (Phase R, the daily reveal): open jobs in India read, the ones in the user's fields, the ones that
 * fit (the ranked list), and a sample of the field (company and logo) for the reveal's scene. */
export type DailyStats = { read: number; fields: number; fits: number; field: FeedPool["field"] };

export type DailySetRow = { day: string; jobIds: string[]; released: number; basis: string; pushedAt: Date | null; stats: DailyStats | null; revealedAt: Date | null };

// The India day, by the database's clock, so every process agrees on when it turns.
async function readSet(userId: string): Promise<DailySetRow | null> {
  const rows = await db.$queryRaw<DailySetRow[]>`
    SELECT to_char("day", 'YYYY-MM-DD') AS day, "jobIds", released, basis, "pushedAt", stats, "revealedAt" FROM "DailySet"
    WHERE "userId" = ${userId} AND "day" = (now() AT TIME ZONE 'Asia/Kolkata')::date`;
  return rows[0] ?? null;
}

/**
 * What the set was built from: the tracks the feed shows (with nearby), the avoids, the gate and the verdict path with
 * its hash (the old judge's `fromHash` until P6's fit lands). The user changing their fields, or a resume the confirm
 * screen changed after the upload's prescan built a set, gives a new basis and so a new set. Null without a profile.
 */
export async function setBasis(userId: string): Promise<string | null> {
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { tracks: true, showNearby: true, avoid: true, currentTitle: true, yearsExperience: true, skills: true, experience: true, education: true },
  });
  if (!profile) return null;
  const basis = {
    tracks: feedTracks(tracksOf(profile), profile.showNearby === true),
    avoid: [...(profile.avoid ?? [])].sort(),
    gate: readingGateOn(),
    path: "judge",
    from: judgeFromHash(profile),
  };
  return createHash("md5").update(JSON.stringify(basis)).digest("hex");
}

async function swipedAmong(userId: string, jobIds: string[]) {
  if (jobIds.length === 0) return new Set<string>();
  const rows = await db.swipe.findMany({ where: { userId, jobId: { in: jobIds } }, select: { jobId: true } });
  return new Set(rows.map((row) => row.jobId));
}

const short = (userId: string) => `…${userId.slice(-6)}`;

/** How long a request waits for another build's set while that build holds the user's fit lease (P6). */
const BUILD_WAIT_MS = 30_000;
const AFTER_LEASE_MS = 8_000;

/** Whether a fit build of this user holds its lease now (fit.ts takeLease, on CandidateBrief.fitBuildUntil). */
async function fitBuildRunning(userId: string) {
  const [row] = await db.$queryRaw<Array<{ running: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM "CandidateBrief" WHERE "userId" = ${userId} AND "fitBuildUntil" > now()) AS running`;
  return row?.running === true;
}

/**
 * Today's set, built when missing (INSERT … ON CONFLICT DO NOTHING, then read: two requests at once get the same row)
 * or rebuilt when its basis changed (compare-and-set on the old basis). Not stored: fewer than DAILY_SET_SIZE jobs to
 * pick (no short sets: the ranked list as before) or a degraded feed (verdicts missing; the next build tries again).
 * Null when the switch is off, there is no profile, or no set could be stored.
 */
/** Open jobs in India: what the agent reads each day (the reveal's first number). */
async function openJobsInIndia() {
  return db.job.count({ where: { closedAt: null, eligibility: { in: ["india", "remote_india"] } } });
}

export async function ensureDailySet(userId: string, ranked?: { jobs: FeedJob[]; degraded: boolean; found?: FeedPool }): Promise<DailySetRow | null> {
  if (!dailySetOn()) return null;
  const [basis, existing] = await Promise.all([setBasis(userId), readSet(userId)]);
  if (!basis) return null;
  if (existing && existing.basis === basis) return existing;
  const feed = ranked ?? (await rankedFeed(userId));
  if (feed.degraded) {
    // With RELEVANCE_FIT on, a second request while another build of this user holds the fit lease reads only what is
    // judged so far, so its feed is degraded: it waits for that build's set instead of giving up (two tabs at once get
    // the same set). A failed call (no build running) returns at once, as before.
    if (!existing && (await fitBuildRunning(userId))) {
      // The other build releases the lease just before it ranks and writes its set: after the lease is free, keep
      // reading for a short grace (AFTER_LEASE_MS) before giving up.
      let freeSince: number | null = null;
      for (let waited = 0; waited < BUILD_WAIT_MS; waited += 500) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const row = await readSet(userId);
        if (row && row.basis === basis) return row;
        if (freeSince == null && !(await fitBuildRunning(userId))) freeSince = Date.now();
        if (freeSince != null && Date.now() - freeSince > AFTER_LEASE_MS) break;
      }
    }
    console.log(`daily-set ${short(userId)}: not built, verdicts missing (the next build tries again)`);
    return existing;
  }
  // Swipes from the table, not the cached list: a swipe saved by another process may not have reached this cache.
  const top = feed.jobs.slice(0, setSize() + 20).map((job) => job.id);
  const swiped = await swipedAmong(userId, top);
  const jobIds = top.filter((id) => !swiped.has(id)).slice(0, setSize());
  // A set built on another basis no longer fits the user's fields: without a full new one, the ranked list.
  if (jobIds.length < setSize()) return null;
  // What the agent did, kept with the set for the reveal (Phase R); a cached feed without its pool counts its cards.
  const stats: DailyStats = { read: await openJobsInIndia(), fields: feed.found?.pool ?? feed.jobs.length, fits: feed.jobs.length, field: feed.found?.field ?? [] };
  const statsJson = JSON.stringify(stats);
  // Only the request whose write landed logs it: a concurrent one reads the same row and says nothing.
  let wrote: number;
  if (!existing) {
    wrote = await db.$executeRaw`
      INSERT INTO "DailySet" ("userId", "day", "jobIds", released, basis, stats)
      VALUES (${userId}, (now() AT TIME ZONE 'Asia/Kolkata')::date, ${jobIds}::text[], ${releaseSize()}, ${basis}, ${statsJson}::jsonb)
      ON CONFLICT ("userId", "day") DO NOTHING`;
  } else {
    wrote = await db.$executeRaw`
      UPDATE "DailySet" SET "jobIds" = ${jobIds}::text[], released = ${releaseSize()}, basis = ${basis}, stats = ${statsJson}::jsonb, "builtAt" = now()
      WHERE "userId" = ${userId} AND "day" = (now() AT TIME ZONE 'Asia/Kolkata')::date AND basis = ${existing.basis}`;
  }
  const row = await readSet(userId);
  if (wrote === 1 && row) console.log(`daily-set ${short(userId)} ${row.day}: ${existing ? "rebuilt (basis changed)" : "built"}, ${row.jobIds.length} jobs (read ${stats.read}, fields ${stats.fields}, fits ${stats.fits})`);
  return row;
}

/** What the deck shows of the set: the released jobs still open to the user, in set order, and whether more remain. */
export type DailyView = {
  jobs: FeedJob[];
  /** Jobs in today's set. */
  total: number;
  /** How many of them are released (never above total). */
  released: number;
  /** Unreleased jobs still open to the user: the deck offers "4 more". */
  more: boolean;
  /** How many the next release brings (the button's number; fewer than DAILY_RELEASE near the end of the set). */
  next: number;
  /** The day's reveal (Phase R) while it is unseen: what the agent did, and whether to play it in full. Null once seen. */
  reveal: DailyReveal | null;
};

export type DailyReveal = { stats: DailyStats; full: boolean };

/** Full for a user's first FULL_DAYS revealed days and after AWAY_DAYS away; the short one otherwise (TDD 4.3). */
const FULL_DAYS = 3;
const AWAY_DAYS = 4;
async function revealIsFull(userId: string) {
  const [row] = await db.$queryRaw<Array<{ seen: number; away: number | null }>>`
    SELECT count(*)::int AS seen, ((now() AT TIME ZONE 'Asia/Kolkata')::date - max("day"))::int AS away FROM "DailySet"
    WHERE "userId" = ${userId} AND "revealedAt" IS NOT NULL AND "day" < (now() AT TIME ZONE 'Asia/Kolkata')::date`;
  return !row || row.seen < FULL_DAYS || (row.away ?? 0) > AWAY_DAYS;
}

/** Today's reveal seen (POST /api/daily-set/reveal): it does not play again today, on any device. False without a set. */
export async function markRevealed(userId: string) {
  const rows = await db.$executeRaw`
    UPDATE "DailySet" SET "revealedAt" = coalesce("revealedAt", now())
    WHERE "userId" = ${userId} AND "day" = (now() AT TIME ZONE 'Asia/Kolkata')::date`;
  return rows === 1;
}

/**
 * The release for the deck: `set[0 .. released)` minus jobs swiped (the Swipe table) and minus jobs no longer in the
 * whole ranked list (closed, out of the gates, under the minimum). Null when there is no set: the ranked list as before.
 */
export async function dailyView(userId: string): Promise<DailyView | null> {
  if (!dailySetOn()) return null;
  const ranked = await rankedFeed(userId);
  const set = await ensureDailySet(userId, ranked);
  if (!set) return null;
  const byId = new Map(ranked.jobs.map((job) => [job.id, job]));
  const swiped = await swipedAmong(userId, set.jobIds);
  const open = (id: string) => byId.has(id) && !swiped.has(id);
  const released = Math.min(set.released, set.jobIds.length);
  // The reveal plays while unseen, from stats kept with the set (none on a set from before Phase R), and only when it has
  // at least 2 open jobs to show: a nearly finished day goes straight to the cards.
  const reveal = set.stats && !set.revealedAt && set.jobIds.filter(open).length >= 2 ? { stats: set.stats, full: await revealIsFull(userId) } : null;
  return {
    reveal,
    jobs: set.jobIds.slice(0, released).filter(open).map((id) => byId.get(id)!),
    total: set.jobIds.length,
    released,
    more: set.jobIds.slice(released).some(open),
    next: set.jobIds.slice(released, released + releaseSize()).filter(open).length,
  };
}

/**
 * "4 more": advances `released` by DAILY_RELEASE only if it still equals `from` (compare-and-set), so a refresh or a
 * second tab that asks again cannot skip a batch. Returns whether it advanced and the release either way.
 */
export async function releaseMore(userId: string, from: number): Promise<{ advanced: boolean; view: DailyView | null }> {
  const advanced = await db.$executeRaw`
    UPDATE "DailySet" SET released = released + ${releaseSize()}
    WHERE "userId" = ${userId} AND "day" = (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND released = ${from} AND released < cardinality("jobIds")`;
  return { advanced: advanced === 1, view: await dailyView(userId) };
}

/**
 * The push step (after every afterIngest call): from DAILY_PUSH_HOUR_IST, each user with push on and no push yet today
 * gets their set built if missing, then one "Today's set is ready". `pushedAt` is claimed by compare-and-set before
 * sending, so two processes never both send. Sets are built only before the deadline; pushes for built sets always go.
 */
export async function pushDailySets(deadline: number, only?: string[]) {
  if (!dailySetOn()) return { pushed: 0 };
  const [{ hour }] = await db.$queryRaw<Array<{ hour: number }>>`SELECT extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::int AS hour`;
  if (hour < pushHour()) return { pushed: 0 };
  const users = await db.$queryRaw<Array<{ userId: string }>>`
    SELECT DISTINCT p."userId" FROM "PushSubscription" p
    LEFT JOIN "DailySet" d ON d."userId" = p."userId" AND d."day" = (now() AT TIME ZONE 'Asia/Kolkata')::date
    WHERE d."pushedAt" IS NULL`;
  let pushed = 0;
  // `only`: a test's own throwaway users (scripts/daily-set-test.ts), never anyone else.
  for (const { userId } of users.filter((user) => !only || only.includes(user.userId))) {
    try {
      const set = Date.now() < deadline ? await ensureDailySet(userId) : await readSet(userId);
      if (!set) continue;
      const claimed = await db.$executeRaw`
        UPDATE "DailySet" SET "pushedAt" = now()
        WHERE "userId" = ${userId} AND "day" = (now() AT TIME ZONE 'Asia/Kolkata')::date AND "pushedAt" IS NULL`;
      if (claimed !== 1) continue;
      // What the agent did, in its own words (Phase R); a set from before the stats says how many were picked.
      const body = set.stats ? `Your agent read ${set.stats.read.toLocaleString("en-IN")} open jobs in India and picked ${set.jobIds.length} for you.` : `${set.jobIds.length} jobs picked for you.`;
      const sent = await sendPush(userId, { title: "Today's jobs are ready", body, url: "/feed", tag: "daily-set" });
      pushed += 1;
      console.log(`daily-set push ${short(userId)} ${set.day}: sent to ${sent} ${sent === 1 ? "browser" : "browsers"}`);
    } catch (error) {
      console.error(`daily-set push ${short(userId)}: ${error instanceof Error ? error.message.slice(0, 80) : "failed"}`);
    }
  }
  return { pushed };
}
