// Phase P, P1: reads the feed's pool jobs that have no current reading (modules/jobs/reading.ts readPendingJobs), newest
// first, until --max, the day's budget (JOB_READINGS_PER_DAY, counted from readAt since midnight in India) or --minutes.
// Resumable: a stopped run loses at most one round, whose claims lapse in 10 minutes. Prints the tokens spent and the
// cost per 1,000 jobs read (gpt-4o-mini prices below), then the pool's coverage.
//   npx tsx scripts/backfill-job-reading.ts [--max 200] [--minutes 60]
import { db } from "../src/lib/db";
import { llmUsage } from "../src/lib/llm";
import { readingCoverage, readPendingJobs } from "../src/modules/jobs/reading";

// USD per million tokens, gpt-4o-mini (OPENAI_MODEL's default).
const INPUT_PER_M = 0.15;
const OUTPUT_PER_M = 0.6;

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? Number(process.argv[at + 1]) : undefined;
}

async function main() {
  const max = arg("--max") ?? Infinity;
  const minutes = arg("--minutes") ?? 120;
  const started = Date.now();
  const deadline = started + minutes * 60_000;
  const before = await readingCoverage();
  console.log(`backfill: ${before.current} of ${before.pool} pool jobs read, ${before.unread} to go`);
  const totals = { read: 0, failed: 0, skipped: 0, dropped: 0, budgetLeft: 0 };
  // Rounds of 200, so progress shows and a stop loses little.
  while (totals.read + totals.failed + totals.skipped < max && Date.now() < deadline) {
    const round = await readPendingJobs({ deadline, max: Math.min(200, max - totals.read - totals.failed - totals.skipped) });
    totals.read += round.read;
    totals.failed += round.failed;
    totals.skipped += round.skipped;
    totals.dropped += round.dropped;
    totals.budgetLeft = round.budgetLeft;
    console.log(`  read=${totals.read} failed=${totals.failed} skipped=${totals.skipped} budget_left=${round.budgetLeft} ${Math.round((Date.now() - started) / 1000)} s`);
    if (round.read + round.failed + round.skipped === 0 || round.budgetLeft === 0) break;
  }
  const per1000 = (tokens: number) => (totals.read > 0 ? Math.round((tokens / totals.read) * 1000) : 0);
  const cost = (llmUsage.input * INPUT_PER_M + llmUsage.output * OUTPUT_PER_M) / 1e6;
  console.log(`backfill done: ${JSON.stringify(totals)} in ${Math.round((Date.now() - started) / 1000)} s`);
  console.log(
    `tokens: ${llmUsage.calls} calls, input ${llmUsage.input}, output ${llmUsage.output}; per 1,000 jobs read: input ${per1000(llmUsage.input)}, output ${per1000(llmUsage.output)}, $${totals.read > 0 ? ((cost / totals.read) * 1000).toFixed(2) : "0"} ($${cost.toFixed(2)} this run)`,
  );
  const after = await readingCoverage();
  console.log(`coverage: ${after.current} of ${after.pool} pool jobs read (${((100 * after.current) / Math.max(1, after.pool)).toFixed(1)} %), ${after.unread} unread (${after.noText} wait for a description), ${after.failing} failing`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
