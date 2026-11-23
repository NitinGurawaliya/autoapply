import type { Job } from "pg-boss";
import { db } from "@/lib/db";
import { enqueueSourceIngest } from "@/lib/queue";
import { runSourceIngest } from "@/modules/apply/sites/ingest";
import { sourceRules } from "@/modules/governance";
import { isSite, runsToday, SITES } from "@/modules/sources";

/** One user's run on a signed-in site, in their window (lib/queue.ts INGEST_SOURCE_QUEUE; worker with a screen). */
export async function handleSourceIngest(jobs: Job<{ userId: string; site: string }>[]) {
  for (const job of jobs) {
    const { userId, site } = job.data;
    if (typeof userId !== "string" || typeof site !== "string" || !isSite(site)) continue;
    try {
      const outcome = await runSourceIngest(userId, site);
      if (outcome.status === "skipped") console.log(`source-ingest ${site} …${userId.slice(-6)}: skipped (${outcome.reason})`);
    } catch (error) {
      console.error(`source-ingest ${site}: ${error instanceof Error ? error.message.slice(0, 120) : "failed"}`);
    }
  }
}

/**
 * The schedule's tick (worker/schedule.ts): one run for every connected user whose site is not paused and who has runs
 * left today. Queueing only; the run itself waits for a worker with a screen.
 */
export async function handleSourceIngestTick() {
  const now = new Date();
  const connections = await db.siteConnection.findMany({
    where: { site: { in: [...SITES] }, OR: [{ status: "connected" }, { status: "limited", pausedUntil: { lte: now } }] },
    select: { userId: true, site: true },
  });
  let queued = 0;
  for (const { userId, site } of connections) {
    if (!isSite(site)) continue;
    const rules = sourceRules(site);
    if (!rules || (await runsToday(userId, site, now)) >= rules.runs_per_day) continue;
    if (await enqueueSourceIngest(userId, site).catch(() => null)) queued += 1;
  }
  if (connections.length > 0) console.log(`source-ingest tick: ${queued} of ${connections.length} connected account(s) queued`);
}
