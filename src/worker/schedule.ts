import type { PgBoss } from "pg-boss";

export const DEFAULT_INGEST_CRON = "0 */6 * * *";

/**
 * Registers the recurring jobs. pg-boss stores the schedule in the database, so several workers registering the same
 * one is harmless, and a run missed while every worker was down happens once when one returns (`missed: "once"`).
 */
export async function registerSchedules(boss: PgBoss) {
  const cron = process.env.INGEST_CRON?.trim() || DEFAULT_INGEST_CRON;
  const days = Number(process.env.INGEST_DAYS) || 7;
  await boss.schedule("ingest", cron, { days }, { tz: "UTC", missed: "once", expireInSeconds: 1800, retryLimit: 0 });
  const schedule = await boss.getSchedule("ingest");
  return { cron: schedule?.cron ?? cron, timezone: schedule?.timezone ?? "UTC", days };
}
