import type { Job } from "pg-boss";
import { writeBoardDay } from "@/modules/jobs";

/**
 * The `board-day` queue (Phase M, M1): the daily cron at 23:30 UTC writes that UTC day's row per board. A late run
 * (`missed: "once"` after the worker was down) still writes the day it was scheduled for when it starts before
 * midnight; after midnight it writes the new day, and the missed day is filled with `scripts/board-day.ts --day`.
 */
export async function handleBoardDay(jobs: Job<{ day?: string }>[]) {
  for (const job of jobs) {
    const day = job.data?.day ? new Date(job.data.day) : new Date();
    if (Number.isNaN(day.getTime())) throw new Error(`board-day: not a day: ${job.data?.day}`);
    const rows = await writeBoardDay(day);
    console.log(`board-day ${rows[0]?.day.toISOString().slice(0, 10) ?? "-"}: ${rows.map((row) => `${row.source} ${row.openIndia} open India, ${row.newIndia} new`).join("; ")}`);
  }
}
