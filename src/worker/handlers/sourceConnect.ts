import type { Job } from "pg-boss";
import { runConnect } from "@/modules/apply/sites/connect";
import { failConnect, isSite } from "@/modules/sources";

/** Sign-in to a user's own job-site account in a visible window (lib/queue.ts SOURCE_CONNECT_QUEUE). */
export async function handleSourceConnect(jobs: Job<{ userId: string; site: string }>[]) {
  for (const job of jobs) {
    const { userId, site } = job.data;
    if (typeof userId !== "string" || typeof site !== "string" || !isSite(site)) continue;
    try {
      await runConnect(userId, site);
    } catch (error) {
      console.error(`source-connect ${site}: ${error instanceof Error ? error.message.slice(0, 120) : "failed"}`);
      await failConnect(userId, site, "The sign-in window could not be opened. Try again in a minute.");
    }
  }
}
