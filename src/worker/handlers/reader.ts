import type { Job } from "pg-boss";
import { enqueueReaderRun } from "@/lib/queue";
import { runReader } from "@/modules/apply/sites/reader";
import { readerRules } from "@/modules/governance";
import { dueBuckets, isSite, planReaderBuckets, sharedReaderOn, SITES } from "@/modules/sources";

/**
 * The shared reader's plan tick (K14, worker/schedule.ts keeps it every 20 minutes): the search buckets from the connected
 * users' profiles are brought up to date, and a reader window is queued when some are due. Queueing only; the window waits
 * for a worker with a screen.
 */
export async function handleReaderPlan() {
  if (!sharedReaderOn()) return;
  for (const site of SITES) {
    const rules = readerRules(site);
    if (!rules) continue;
    const plan = await planReaderBuckets(site, rules);
    const due = await dueBuckets(site);
    console.log(`reader plan ${site}: ${plan.users} connected, ${plan.buckets} buckets (${plan.added} new, ${plan.retired} retired), ${due} due`);
    if (due > 0) for (let reader = 1; reader <= rules.readers; reader += 1) await enqueueReaderRun(site, reader).catch(() => null);
  }
}

/** One window of the shared reader (lib/queue.ts READER_RUN_QUEUE; worker with a screen). */
export async function handleReaderRun(jobs: Job<{ site: string; reader: number }>[]) {
  for (const job of jobs) {
    const { site, reader } = job.data;
    if (typeof site !== "string" || !isSite(site) || !Number.isInteger(reader)) continue;
    try {
      const outcome = await runReader(site, { reader });
      if (outcome.status === "skipped") console.log(`reader ${site}: skipped (${outcome.reason})`);
    } catch (error) {
      console.error(`reader ${site}: ${error instanceof Error ? error.message.slice(0, 120) : "failed"}`);
    }
  }
}
