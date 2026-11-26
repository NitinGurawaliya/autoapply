import type { Job } from "pg-boss";
import { enqueueIngestCompanies } from "@/lib/queue";
import { dueCompanies, startTickRun } from "@/modules/jobs";
import { afterIngest, afterIngestDeadline } from "@/modules/jobs/after-ingest";
import { refreshCompanyFacts } from "@/modules/jobs/company-facts";
import { refreshLogos } from "@/modules/jobs/logos";

// How many due companies one tick sends at most: 2,000 every 5 minutes reads 20,000 newly seeded companies within an
// hour (scripts/ingest-scale-smoke.ts: 54 min cold, 5 min overdue at most in steady state).
const BATCH = () => Math.min(Math.max(Number(process.env.INGEST_TICK_BATCH) || 2000, 1), 10000);
// The shared tail (embed, skills labels, job reading, warm, hourly cleanup: after-ingest.ts) runs in the background after
// the tick's sends, so a slow tail never holds a tick past its expiry; never two at once in this process.
let afterRunning = false;
// Logos (owner, 18 Nov: every company on the cards has one): a few companies without one each tick, India-hiring first,
// in the background so the tick is not held up; never two sweeps at once.
const LOGOS_PER_TICK = () => Math.min(Math.max(Number(process.env.LOGOS_PER_TICK) || 40, 0), 500);
let logosRunning = false;
// Each board account's own website and real name (Phase W, W2, docs/employers/TDD.md 4.5): a few per tick, in the
// background, never two sweeps at once. FACTS_PER_TICK=0 turns it off.
const FACTS_PER_TICK = () => Math.min(Math.max(Number(process.env.FACTS_PER_TICK) || 40, 0), 500);
let factsRunning = false;

/**
 * The `ingest-tick` queue (INGEST_MODE=tick, Phase M, M2). Every tick: each company due for a read gets its own
 * `ingest-company` job, most overdue first; then, in the background, the shared tail for the reads the last ticks
 * finished (after-ingest.ts, AFTER_INGEST_TICK_MS) and a few missing logos.
 */
export async function handleIngestTick(jobs: Job<object>[]) {
  for (const _job of jobs) {
    void _job;
    const due = await dueCompanies(BATCH());
    if (due.length > 0) {
      const runId = await startTickRun(due.length);
      const sent = await enqueueIngestCompanies(due, runId);
      // A company already waiting or running is not sent twice (the queue's exclusive policy): `sent` counts the new ones.
      console.log(`ingest-tick: ${due.length} due, ${sent} sent (${runId})`);
    }
    if (!afterRunning) {
      afterRunning = true;
      void afterIngest({ deadlineMs: afterIngestDeadline("tick"), label: "tick" })
        .catch(() => undefined)
        .finally(() => {
          afterRunning = false;
        });
    }
    if (!factsRunning && FACTS_PER_TICK() > 0) {
      factsRunning = true;
      void refreshCompanyFacts({ limit: FACTS_PER_TICK(), write: true })
        .then((done) => done.checked > 0 && console.log(`ingest-tick: facts ${done.withDomain} with a domain of ${done.checked} looked at, ${done.renamed} renamed`))
        .catch(() => undefined)
        .finally(() => {
          factsRunning = false;
        });
    }
    if (!logosRunning && LOGOS_PER_TICK() > 0) {
      logosRunning = true;
      void refreshLogos({ limit: LOGOS_PER_TICK(), write: true })
        .then((done) => done.checked > 0 && console.log(`ingest-tick: logos ${done.found} found of ${done.checked} looked at`))
        .catch(() => undefined)
        .finally(() => {
          logosRunning = false;
        });
    }
  }
}
