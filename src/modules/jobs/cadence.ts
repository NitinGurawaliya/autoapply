/**
 * How often each company's board is read (Phase M, M2; docs/boards/TDD.md §4.8). Every company known to be on a
 * board is watched, not only those hiring in India today (owner, 7 Nov): whether a company has an India opening changes
 * week to week. What keeps watching 50,000 companies cheap is how often each one is read:
 *
 *   active  an India-eligible job now, or one seen in the last 30 days   every 3 hours
 *   open    open jobs, none in India for 30 days                        every 24 hours
 *   empty   on the board, no open jobs                                  every 3 days
 *   dead    no open jobs for 90 days, or the board gone 3 times running every 30 days (the re-validation)
 *
 * The tier is worked out again after every read, so a company moves up as soon as it lists an India job. A failed
 * read backs off: the interval doubles per failure in a row, up to 7 days; 8 in a row makes the company dead.
 * Every next read is jittered ±10% so tens of thousands of companies do not land on the same minute.
 */

export const TIERS = ["active", "open", "empty", "dead"] as const;
export type Tier = (typeof TIERS)[number];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const INTERVAL_MS: Record<Tier, number> = { active: 3 * HOUR, open: DAY, empty: 3 * DAY, dead: 30 * DAY };
export const INDIA_RECENT_DAYS = 30;
export const DEAD_AFTER_EMPTY_DAYS = 90;
export const DEAD_AFTER_NOT_FOUND = 3;
export const DEAD_AFTER_FAILURES = 8;
export const MAX_BACKOFF_MS = 7 * DAY;
export const JITTER = 0.1;

/**
 * Boards read gently (owner, 18 Nov): Workday's Cloudflare put this server's reads through a bot check when we read it
 * hard (206 tenants every 3 hours, four postings at a time). Their companies are read GENTLE_SCALE times less often
 * (active: every 12 hours), one company at a time across workers (queue group tier "gentle"), at most GENTLE_PER_TICK
 * sent a tick. Workday jobs are not in the feed yet (no adapter), so a slower read costs nobody a fresh job.
 */
export const GENTLE_BOARDS: ReadonlySet<string> = new Set(["workday"]);
export const GENTLE_SCALE = 4;
export const GENTLE_PER_TICK = 3;
export const GENTLE_GROUP_TIER = "gentle";

/**
 * A read the board refused (a 429 or its bot check, "... refused" from the fetcher): it says nothing about the company,
 * so it is not a failure in a row (no back-off, never makes the company dead); the company is read at its tier's pace.
 */
export const REFUSED = /\brefused\b/;

export type WatchState = {
  /** Jobs the board listed at this read (0 when the read failed). */
  listed: number;
  /** India-eligible jobs it listed at this read. */
  indiaListed: number;
  /** The last read that listed an India-eligible job (this one included). */
  lastIndiaAt: Date | null;
  /** Since when the board has listed nothing (null while it lists something). */
  emptySince: Date | null;
  /** Failed reads in a row, this one included. */
  failures: number;
  /** Of those, how many said the board is not there (404, 410). */
  notFound: number;
};

/** The tier a company belongs in after a read. */
export function tierOf(state: WatchState, now = new Date()): Tier {
  if (state.notFound >= DEAD_AFTER_NOT_FOUND || state.failures >= DEAD_AFTER_FAILURES) return "dead";
  if (state.failures > 0) {
    // A failed read says nothing new: keep the company where its last good read put it, judged on what is known.
    if (state.lastIndiaAt && now.getTime() - state.lastIndiaAt.getTime() <= INDIA_RECENT_DAYS * DAY) return "active";
    return state.emptySince ? emptyOrDead(state.emptySince, now) : "open";
  }
  if (state.indiaListed > 0) return "active";
  if (state.lastIndiaAt && now.getTime() - state.lastIndiaAt.getTime() <= INDIA_RECENT_DAYS * DAY) return "active";
  if (state.listed > 0) return "open";
  return emptyOrDead(state.emptySince ?? now, now);
}

function emptyOrDead(emptySince: Date, now: Date): Tier {
  return now.getTime() - emptySince.getTime() > DEAD_AFTER_EMPTY_DAYS * DAY ? "dead" : "empty";
}

/**
 * When to read the company next: its tier's interval (times `scale` for a gentle board, except dead), doubled per
 * failure in a row (at most 7 days), jittered ±10%.
 */
export function nextFetchAt(tier: Tier, failures: number, now = new Date(), random: () => number = Math.random, scale = 1) {
  const base = INTERVAL_MS[tier] * (tier === "dead" ? 1 : scale);
  const backedOff = failures > 0 && tier !== "dead" ? Math.min(base * 2 ** failures, Math.max(MAX_BACKOFF_MS, base)) : base;
  const jitter = 1 + (random() * 2 - 1) * JITTER;
  return new Date(now.getTime() + Math.round(backedOff * jitter));
}

/** Reads a day for one company in a tier with no failures (for estimates and the scale smoke). */
export function readsPerDay(tier: Tier) {
  return DAY / INTERVAL_MS[tier];
}
