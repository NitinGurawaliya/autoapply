import type { PgBoss } from "pg-boss";

// Every 3 hours, keeping jobs posted in the last 60 days: an open job stays in the feed while it is listed (T79).
export const DEFAULT_INGEST_CRON = "0 */3 * * *";
export const DEFAULT_INGEST_DAYS = 60;

/**
 * Registers the recurring jobs. pg-boss stores the schedule in the database, so several workers registering the same
 * one is harmless, and a run missed while every worker was down happens once when one returns (`missed: "once"`).
 */
export async function registerSchedules(boss: PgBoss) {
  const cron = process.env.INGEST_CRON?.trim() || DEFAULT_INGEST_CRON;
  const days = Number(process.env.INGEST_DAYS) || DEFAULT_INGEST_DAYS;
  await boss.schedule("ingest", cron, { days }, { tz: "UTC", missed: "once", expireInSeconds: 7200, retryLimit: 0 });
  const schedule = await boss.getSchedule("ingest");
  return { cron: schedule?.cron ?? cron, timezone: schedule?.timezone ?? "UTC", days };
}
