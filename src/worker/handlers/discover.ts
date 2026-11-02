import type { Job } from "pg-boss";
import { enqueueDiscover } from "@/lib/queue";
import { BOARDS, runDiscovery } from "@/modules/jobs/discovery";

/**
 * The `discover` queue. The daily schedule sends a job with no board: it hands each board its own job (lib/queue.ts
 * enqueueDiscover), which this worker then takes one after another, each with its own time. A job with a board runs
 * discovery on that board alone. Before 2 Nov one job ran every board in turn within one hour: Greenhouse alone took
 * 52 minutes, the job was marked failed, and the boards after it rarely or never ran.
 */
export async function handleDiscover(jobs: Job<{ board?: string }>[]) {
  for (const job of jobs) {
    const board = job.data?.board;
    if (!board) {
      for (const item of BOARDS) await enqueueDiscover(item.source);
      console.log(`discover: one job each for ${BOARDS.map((item) => item.source).join(", ")}`);
      continue;
    }
    if (!BOARDS.some((item) => item.source === board)) throw new Error(`discover: no discovery for board ${board}`);
    const totals = await runDiscovery({ boards: [board] });
    console.log(`discover ${board}: ${JSON.stringify(totals[board] ?? {})}`);
  }
}
