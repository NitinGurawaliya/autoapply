// Phase M, M2: the watch tiers, intervals, jitter bounds, back-off, promotion on a new India job, dead after 90 days
// empty or 3 reads finding no board. Offline. npx tsx scripts/cadence-test.ts
import { DEAD_AFTER_FAILURES, GENTLE_SCALE, INTERVAL_MS, MAX_BACKOFF_MS, nextFetchAt, readsPerDay, REFUSED, tierOf, type WatchState } from "../src/modules/jobs/cadence";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-09T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const base: WatchState = { listed: 10, indiaListed: 0, lastIndiaAt: null, emptySince: null, failures: 0, notFound: 0 };

check("an India job listed now is active", tierOf({ ...base, indiaListed: 2, lastIndiaAt: now }, now) === "active");
check("an India job seen 20 days ago keeps it active", tierOf({ ...base, lastIndiaAt: ago(20) }, now) === "active");
check("none for 31 days, other openings: open", tierOf({ ...base, lastIndiaAt: ago(31) }, now) === "open");
check("never an India job, openings: open", tierOf(base, now) === "open");
check("no openings: empty", tierOf({ ...base, listed: 0, emptySince: ago(10) }, now) === "empty");
check("no openings for 91 days: dead", tierOf({ ...base, listed: 0, emptySince: ago(91) }, now) === "dead");
check("3 reads finding no board: dead", tierOf({ ...base, failures: 3, notFound: 3 }, now) === "dead");
check(`${DEAD_AFTER_FAILURES} failures in a row: dead`, tierOf({ ...base, failures: DEAD_AFTER_FAILURES }, now) === "dead");
check("a failed read keeps an India company active", tierOf({ ...base, listed: 0, failures: 2, lastIndiaAt: ago(5) }, now) === "active");
check("a failed read of an empty board keeps it empty", tierOf({ ...base, listed: 0, failures: 1, emptySince: ago(5) }, now) === "empty");
check("a dead company that lists an India job again is active at once", tierOf({ ...base, indiaListed: 1, lastIndiaAt: now, emptySince: null }, now) === "active");

const mid = () => 0.5;
check("active: every 3 hours", nextFetchAt("active", 0, now, mid).getTime() - now.getTime() === INTERVAL_MS.active);
check("open: every day", nextFetchAt("open", 0, now, mid).getTime() - now.getTime() === DAY);
check("empty: every 3 days", nextFetchAt("empty", 0, now, mid).getTime() - now.getTime() === 3 * DAY);
check("dead: every 30 days", nextFetchAt("dead", 0, now, mid).getTime() - now.getTime() === 30 * DAY);
const low = nextFetchAt("active", 0, now, () => 0).getTime() - now.getTime();
const high = nextFetchAt("active", 0, now, () => 0.999999).getTime() - now.getTime();
check("jitter stays within ±10%", low >= INTERVAL_MS.active * 0.9 - 1 && high <= INTERVAL_MS.active * 1.1 + 1 && low < high, `${low} … ${high}`);
check("a failure doubles the interval", nextFetchAt("active", 1, now, mid).getTime() - now.getTime() === 2 * INTERVAL_MS.active);
check("back-off stops at 7 days", nextFetchAt("open", 6, now, mid).getTime() - now.getTime() === MAX_BACKOFF_MS);
check("reads a day: 8, 1, 1/3, 1/30", readsPerDay("active") === 8 && readsPerDay("open") === 1 && Math.abs(readsPerDay("empty") - 1 / 3) < 1e-9 && Math.abs(readsPerDay("dead") - 1 / 30) < 1e-9);

// 18 Nov: gentle boards (Workday) read 4 times less often, the monthly dead read unchanged; a refused read is told apart.
check("gentle board, active: every 12 hours", nextFetchAt("active", 0, now, mid, GENTLE_SCALE).getTime() - now.getTime() === 12 * 60 * 60 * 1000);
check("gentle board, dead: still every 30 days", nextFetchAt("dead", 0, now, mid, GENTLE_SCALE).getTime() - now.getTime() === 30 * DAY);
check("a refused read is recognised, a server error is not", REFUSED.test("workday cw/External 429 refused (bot check)") && !REFUSED.test("lever plus-2 500") && !REFUSED.test("workable emsar 429"));

console.log(failed ? `FAIL cadence-test: ${failed} failed` : "PASS cadence-test");
if (failed) process.exitCode = 1;
