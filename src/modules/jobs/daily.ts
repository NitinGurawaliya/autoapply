import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { sendPush } from "@/lib/push";
import { tracksOf } from "./functions";
import { readingGateOn } from "./gate";
import { feedTracks, type FeedFilters, type FeedJob, parseFeedFilters, rankedFeed } from "./match";
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
export const releaseSize = () => envInt("DAILY_RELEASE", 4);
const pushHour = () => envInt("DAILY_PUSH_HOUR_IST", 8);

/** The set serves only the default view: no filter in the URL, not the skipped jobs, not "Keep going". */
export function isDefaultFeed(filters: FeedFilters) {
  return JSON.stringify(filters) === JSON.stringify(parseFeedFilters({}));
}

export type DailySetRow = { day: string; jobIds: string[]; released: number; basis: string; pushedAt: Date | null };

// The India day, by the database's clock, so every process agrees on when it turns.
async function readSet(userId: string): Promise<DailySetRow | null> {
  const rows = await db.$queryRaw<DailySetRow[]>`
    SELECT to_char("day", 'YYYY-MM-DD') AS day, "jobIds", released, basis, "pushedAt" FROM "DailySet"
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

/**
 * Today's set, built when missing (INSERT … ON CONFLICT DO NOTHING, then read: two requests at once get the same row)
 * or rebuilt when its basis changed (compare-and-set on the old basis). Not stored: fewer than DAILY_SET_SIZE jobs to
 * pick (no short sets: the ranked list as before) or a degraded feed (verdicts missing; the next build tries again).
 * Null when the switch is off, there is no profile, or no set could be stored.
 */
export async function ensureDailySet(userId: string, ranked?: { jobs: FeedJob[]; degraded: boolean }): Promise<DailySetRow | null> {
  if (!dailySetOn()) return null;
  const [basis, existing] = await Promise.all([setBasis(userId), readSet(userId)]);
  if (!basis) return null;
  if (existing && existing.basis === basis) return existing;
  const feed = ranked ?? (await rankedFeed(userId));
  if (feed.degraded) {
    console.log(`daily-set ${short(userId)}: not built, verdicts missing (the next build tries again)`);
    return existing;
  }
  // Swipes from the table, not the cached list: a swipe saved by another process may not have reached this cache.
  const top = feed.jobs.slice(0, setSize() + 20).map((job) => job.id);
  const swiped = await swipedAmong(userId, top);
  const jobIds = top.filter((id) => !swiped.has(id)).slice(0, setSize());
  // A set built on another basis no longer fits the user's fields: without a full new one, the ranked list.
  if (jobIds.length < setSize()) return null;
  // Only the request whose write landed logs it: a concurrent one reads the same row and says nothing.
  let wrote: number;
  if (!existing) {
    wrote = await db.$executeRaw`
      INSERT INTO "DailySet" ("userId", "day", "jobIds", released, basis)
      VALUES (${userId}, (now() AT TIME ZONE 'Asia/Kolkata')::date, ${jobIds}::text[], ${releaseSize()}, ${basis})
      ON CONFLICT ("userId", "day") DO NOTHING`;
  } else {
    wrote = await db.$executeRaw`
      UPDATE "DailySet" SET "jobIds" = ${jobIds}::text[], released = ${releaseSize()}, basis = ${basis}, "builtAt" = now()
      WHERE "userId" = ${userId} AND "day" = (now() AT TIME ZONE 'Asia/Kolkata')::date AND basis = ${existing.basis}`;
  }
  const row = await readSet(userId);
  if (wrote === 1 && row) console.log(`daily-set ${short(userId)} ${row.day}: ${existing ? "rebuilt (basis changed)" : "built"}, ${row.jobIds.length} jobs`);
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
};

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
  return {
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
      const sent = await sendPush(userId, { title: "Today's set is ready", body: `Your agent picked ${set.jobIds.length} jobs for you.`, url: "/feed", tag: "daily-set" });
      pushed += 1;
      console.log(`daily-set push ${short(userId)} ${set.day}: sent to ${sent} ${sent === 1 ? "browser" : "browsers"}`);
    } catch (error) {
      console.error(`daily-set push ${short(userId)}: ${error instanceof Error ? error.message.slice(0, 80) : "failed"}`);
    }
  }
  return { pushed };
}
