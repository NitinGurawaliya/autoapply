import type { Job } from "pg-boss";
import { ingestOne } from "@/modules/jobs";

/** The `ingest-company` queue (INGEST_MODE=tick, Phase M, M2): one company's read, recorded with its tier and next read. */
export async function handleIngestCompany(jobs: Job<{ companyId: string; runId?: string }>[]) {
  for (const job of jobs) {
    const result = await ingestOne(job.data.companyId, { runId: job.data.runId });
    if (!result) continue;
    if (result.error) console.error(`ingest error ${result.source} ${result.company}: ${result.error}`);
    else console.log(`${result.source} | ${result.company} | ${result.unchanged ? "unchanged" : `${result.fetched} listed | ${result.created} new | ${result.updated} changed${result.closed ? ` | ${result.closed} closed` : ""}`} | ${result.tier}`);
  }
}
