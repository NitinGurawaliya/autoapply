import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/lib/db";
import { pruneRateEvents } from "@/lib/rate-limit";
import { PROFILE_ROOT } from "@/modules/apply/browser";
import { writeEvent } from "@/modules/governance";

export const STALE_AFTER_MINUTES = 3;
export const STALE_MESSAGE = "The worker stopped while running this application. Retry it.";

/**
 * A run whose queue job is still "active" but whose heartbeat stopped belongs to a dead worker. Fail it with a clear
 * reason, cancel its queue job so nothing re-runs it blindly, and free its submit lock. Safe to run from every worker.
 */
export async function reapStaleRuns(staleMinutes = STALE_AFTER_MINUTES) {
  const stale = await db.$queryRaw<Array<{ applicationId: string; jobId: string }>>`
    SELECT a."id" AS "applicationId", j."id"::text AS "jobId"
    FROM "Application" a
    JOIN pgboss.job j ON j.name = 'apply' AND j.state = 'active' AND j.data->>'applicationId' = a."id"
    WHERE a."status" IN ('queued', 'inspecting', 'filling', 'needs_input')
      -- The newer of the last heartbeat and this queue job's start: a run that resumes after the user answered keeps the
      -- heartbeat of its earlier attempt until its first beat, and must not be reaped in those first seconds.
      AND GREATEST(a."heartbeatAt", j.started_on) < now() - (${staleMinutes}::int * interval '1 minute')`;

  let reaped = 0;
  for (const row of stale) {
    const marked = await db.application.updateMany({
      where: { id: row.applicationId, status: { in: ["queued", "inspecting", "filling", "needs_input"] } },
      data: { status: "failed", error: STALE_MESSAGE, pendingQuestions: [], verificationCode: null },
    });
    await db.$executeRaw`UPDATE pgboss.job SET state = 'cancelled', completed_on = now() WHERE id = ${row.jobId}::uuid AND state = 'active'`;
    await db.$executeRaw`DELETE FROM "SubmitLock" WHERE "holderId" = ${row.applicationId}`;
    if (marked.count > 0) {
      await writeEvent(row.applicationId, "error", STALE_MESSAGE);
      reaped += 1;
    }
  }
  return reaped;
}

/**
 * Browser profiles hold a user's cookies, and live on this machine's disk. When a user deletes their account the web
 * app cannot reach this disk, so the worker removes the folders of users that no longer exist.
 */
export async function pruneOrphanProfiles() {
  let names: string[] = [];
  try {
    names = await readdir(PROFILE_ROOT);
  } catch {
    return 0;
  }
  if (names.length === 0) return 0;
  const alive = new Set((await db.user.findMany({ where: { id: { in: names } }, select: { id: true } })).map((user) => user.id));
  let removed = 0;
  for (const name of names) {
    if (alive.has(name)) continue;
    await rm(join(PROFILE_ROOT, name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/** Housekeeping the worker does now and then. */
export async function housekeeping() {
  await pruneRateEvents();
  return pruneOrphanProfiles();
}
