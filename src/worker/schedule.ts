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

/** run: one pass over every company every 3 hours (until M2). tick: each company read when its tier says (M2). */
export function ingestMode(): "run" | "tick" {
  return process.env.INGEST_MODE?.trim() === "tick" ? "tick" : "run";
}

/**
 * Registers the recurring jobs. pg-boss stores the schedule in the database, so several workers registering the same
 * one is harmless, and a run missed while every worker was down happens once when one returns (`missed: "once"`).
 */
export async function registerSchedules(boss: PgBoss) {
  const cron = process.env.INGEST_CRON?.trim() || DEFAULT_INGEST_CRON;
  const days = Number(process.env.INGEST_DAYS) || DEFAULT_INGEST_DAYS;
  const mode = ingestMode();
  const tickCron = process.env.INGEST_TICK_CRON?.trim() || DEFAULT_INGEST_TICK_CRON;
  // One of the two at a time: switching INGEST_MODE takes the other schedule away (both live in the database).
  if (mode === "tick") {
    await boss.unschedule("ingest").catch(() => undefined);
    await boss.schedule("ingest-tick", tickCron, {}, { tz: "UTC", missed: "once", expireInSeconds: 600, retryLimit: 0 });
  } else {
    await boss.unschedule("ingest-tick").catch(() => undefined);
    await boss.schedule("ingest", cron, { days }, { tz: "UTC", missed: "once", expireInSeconds: 7200, retryLimit: 0 });
  }
  const schedule = mode === "tick" ? { cron: tickCron, timezone: "UTC" } : await boss.getSchedule("ingest");
  const discoverCron = process.env.DISCOVER_CRON?.trim() || DEFAULT_DISCOVER_CRON;
  await boss.schedule("discover", discoverCron, {}, { tz: "UTC", missed: "once", expireInSeconds: 3600, retryLimit: 0 });
  const boardDayCron = process.env.BOARD_DAY_CRON?.trim() || DEFAULT_BOARD_DAY_CRON;
  await boss.schedule("board-day", boardDayCron, {}, { tz: "UTC", missed: "once", expireInSeconds: 900, retryLimit: 1 });
  return { mode, cron: schedule?.cron ?? cron, timezone: schedule?.timezone ?? "UTC", days, discoverCron, boardDayCron };
}
