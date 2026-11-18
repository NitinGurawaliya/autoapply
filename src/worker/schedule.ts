import type { PgBoss } from "pg-boss";

// Every 3 hours, keeping jobs posted in the last 60 days: an open job stays in the feed while it is listed (T79).
export const DEFAULT_INGEST_CRON = "0 */3 * * *";
export const DEFAULT_INGEST_DAYS = 60;
// Discovery once a day, before the 03:00 ingest, so companies it adds are fetched the same morning (UTC).
export const DEFAULT_DISCOVER_CRON = "30 1 * * *";
// The per-board measurement of the UTC day, written near its end (Phase M, M1).
export const DEFAULT_BOARD_DAY_CRON = "30 23 * * *";
// Tick mode (Phase M, M2): every 5 minutes, the companies due for a read are sent one job each.
export const DEFAULT_INGEST_TICK_CRON = "*/5 * * * *";

type Env = Record<string, string | undefined>;

/**
 * run: one pass over every company every 3 hours (until M2). tick: each company read when its tier says (M2). off: the
 * worker schedules no ingest; it runs on a GitHub Actions schedule instead (M21, .github/workflows/jobs.yml).
 */
export function ingestMode(env: Env = process.env): "run" | "tick" | "off" {
  const mode = env.INGEST_MODE?.trim();
  return mode === "tick" ? "tick" : mode === "off" ? "off" : "run";
}

/** A cron from the env, its default, or null for "off" (that job runs on GitHub Actions instead, M21). */
function cronOf(value: string | undefined, fallback: string) {
  const cron = value?.trim() || fallback;
  return cron === "off" ? null : cron;
}

/** Which recurring jobs this worker keeps, from the env: a null cron is taken away (pure, so it is tested offline). */
export function schedulePlan(env: Env = process.env) {
  const mode = ingestMode(env);
  return {
    mode,
    ingest: mode === "run" ? cronOf(env.INGEST_CRON, DEFAULT_INGEST_CRON) : null,
    tick: mode === "tick" ? cronOf(env.INGEST_TICK_CRON, DEFAULT_INGEST_TICK_CRON) : null,
    discover: cronOf(env.DISCOVER_CRON, DEFAULT_DISCOVER_CRON),
    boardDay: cronOf(env.BOARD_DAY_CRON, DEFAULT_BOARD_DAY_CRON),
    days: Number(env.INGEST_DAYS) || DEFAULT_INGEST_DAYS,
  };
}

/**
 * Registers the recurring jobs. pg-boss stores the schedule in the database, so several workers registering the same
 * one is harmless, and a run missed while every worker was down happens once when one returns (`missed: "once"`).
 * A job switched off ("off") is unscheduled for every worker: the schedules are shared, so every worker that runs must
 * have the same switches, or the next one to start puts the schedule back.
 */
export async function registerSchedules(boss: PgBoss) {
  const plan = schedulePlan();
  const set = async (name: string, cron: string | null, data: object, options: { expireInSeconds: number; retryLimit: number }) => {
    if (cron) await boss.schedule(name, cron, data, { tz: "UTC", missed: "once", ...options });
    else await boss.unschedule(name).catch(() => undefined);
  };
  // One ingest at most: switching INGEST_MODE takes the other schedule away (both live in the database).
  await set("ingest", plan.ingest, { days: plan.days }, { expireInSeconds: 7200, retryLimit: 0 });
  await set("ingest-tick", plan.tick, {}, { expireInSeconds: 600, retryLimit: 0 });
  await set("discover", plan.discover, {}, { expireInSeconds: 3600, retryLimit: 0 });
  await set("board-day", plan.boardDay, {}, { expireInSeconds: 900, retryLimit: 1 });
  const off = "off (GitHub Actions)";
  return { mode: plan.mode, cron: plan.tick ?? plan.ingest ?? off, timezone: "UTC", days: plan.days, discoverCron: plan.discover ?? off, boardDayCron: plan.boardDay ?? off };
}
