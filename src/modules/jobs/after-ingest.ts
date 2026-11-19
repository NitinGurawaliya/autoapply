import { db } from "@/lib/db";
import { pushDailySets } from "./daily";
import { readPendingJobs } from "./reading";
import { embedPendingJobs, labelPendingSkills } from "./semantic";
import { warmFeeds } from "./warm";

// Closed jobs nobody swiped or applied to are deleted this long after they closed (30 days until M2; 7 since, so the
// table stays near the open jobs at 50,000 companies, docs/boards/TDD.md §4.8).
const DELETE_CLOSED_AFTER_DAYS = 7;
const CLEANUP_EVERY_MS = 60 * 60 * 1000;
let lastCleanup = 0;

/**
 * Closed jobs nobody swiped or applied to, closed more than DELETE_CLOSED_AFTER_DAYS ago: deleted to keep the table
 * small. Jobs in an evaluation pool or labelled by the owner are kept (Phase P, P2: the eval ranks within its stored pool).
 */
export async function deleteOldClosedJobs(now = new Date()) {
  const before = new Date(now.getTime() - DELETE_CLOSED_AFTER_DAYS * 24 * 60 * 60 * 1000);
  return db.$executeRaw`
    DELETE FROM "Job" j
    WHERE j."closedAt" IS NOT NULL AND j."closedAt" < ${before}
      AND NOT EXISTS (SELECT 1 FROM "Swipe" s WHERE s."jobId" = j.id)
      AND NOT EXISTS (SELECT 1 FROM "Application" a WHERE a."jobId" = j.id)
      AND NOT EXISTS (SELECT 1 FROM "EvalPool" e WHERE e."jobId" = j.id)
      AND NOT EXISTS (SELECT 1 FROM "FeedLabel" f WHERE f."jobId" = j.id)`;
}

export type AfterIngestResult = {
  embedded: number;
  labelled: number;
  read: number;
  readFailed: number;
  budgetLeft: number;
  warmed: number | null;
  pushed: number | null;
  deleted: number | null;
  ms: number;
};

function note(step: string, error: unknown) {
  console.error(`after-ingest: ${step} failed (${error instanceof Error ? error.message.slice(0, 100) : "error"}); the next call retries`);
}

/**
 * What every ingest path does once its reads are in (Phase P, docs/relevance/TDD.md 4.1.1), one place for all of them:
 * embed new jobs → label the skills of the feed's pool → read pool jobs (reading.ts) → warm the feeds when anything was
 * embedded, labelled or read → the daily set's morning push (daily.ts, every call) → delete old closed jobs (at most hourly per process). Each step fails alone and stops at
 * the deadline; the next call resumes where this one stopped. Callers: the worker's tick (in the background after its
 * sends, AFTER_INGEST_TICK_MS), scripts/after-ingest-now.ts in the workflow (AFTER_INGEST_RUN_MS) and ingestJobs.
 */
export async function afterIngest(options: { deadlineMs: number; label?: string }): Promise<AfterIngestResult> {
  const started = Date.now();
  const deadline = started + options.deadlineMs;
  const out: AfterIngestResult = { embedded: 0, labelled: 0, read: 0, readFailed: 0, budgetLeft: 0, warmed: null, pushed: null, deleted: null, ms: 0 };
  out.embedded = await embedPendingJobs(20000, deadline).catch((error) => (note("embedding", error), 0));
  if (Date.now() < deadline) {
    const levels = await labelPendingSkills(undefined, deadline).catch((error) => (note("skill labels", error), { labelled: 0, failed: 0 }));
    out.labelled = levels.labelled;
  }
  if (Date.now() < deadline) {
    const reading = await readPendingJobs({ deadline }).catch((error) => (note("job reading", error), null));
    out.read = reading?.read ?? 0;
    out.readFailed = reading?.failed ?? 0;
    out.budgetLeft = reading?.budgetLeft ?? 0;
  }
  // The new verdicts are cached for active users even past the deadline: skipping the warm would leave the next feeds cold.
  if (out.embedded + out.labelled + out.read > 0) {
    const warm = await warmFeeds().catch((error) => (note("warm", error), null));
    out.warmed = warm?.warmed ?? null;
  }
  // The daily set's push (P7) on every call, not only after a warm: the morning hour passes whether or not jobs arrived.
  const push = await pushDailySets(deadline).catch((error) => (note("daily-set push", error), null));
  out.pushed = push?.pushed ?? null;
  if (Date.now() - lastCleanup > CLEANUP_EVERY_MS) {
    lastCleanup = Date.now();
    out.deleted = await deleteOldClosedJobs().catch((error) => (note("cleanup", error), null));
  }
  out.ms = Date.now() - started;
  console.log(
    `after-ingest${options.label ? ` (${options.label})` : ""} embedded=${out.embedded} labelled=${out.labelled} read=${out.read} read_failed=${out.readFailed} budget_left=${out.budgetLeft} warmed=${out.warmed ?? "-"} pushed=${out.pushed ?? "-"} deleted=${out.deleted ?? "-"} ms=${out.ms}`,
  );
  return out;
}

/** AFTER_INGEST_TICK_MS (8 minutes) or AFTER_INGEST_RUN_MS (40 minutes). */
export function afterIngestDeadline(kind: "tick" | "run") {
  const value = Number(kind === "tick" ? process.env.AFTER_INGEST_TICK_MS : process.env.AFTER_INGEST_RUN_MS);
  return Number.isFinite(value) && value > 0 ? value : kind === "tick" ? 480_000 : 2_400_000;
}
