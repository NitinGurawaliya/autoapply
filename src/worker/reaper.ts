import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/lib/db";
import { APPLY_QUEUES, enqueueApply } from "@/lib/queue";
import { pruneRateEvents } from "@/lib/rate-limit";
import { PROFILE_ROOT } from "@/modules/apply/browser";
import { writeEvent } from "@/modules/governance";

export const STALE_AFTER_MINUTES = 3;
export const STALE_MESSAGE = "The worker stopped while running this application. Retry it.";
export const STALE_AFTER_SUBMIT = "The worker stopped right after pressing Submit, so it may have been sent. Check your email before applying again.";
// A run cut off before Submit is picked up again this many times (worker restarts, deploys) before it fails.
const MAX_RESUMES = 2;

/**
 * A run whose queue job is still "active" but whose heartbeat stopped belongs to a dead worker (a restart, a deploy, a
 * laptop going to sleep: 11 of the 30 failures in the week to 10 Oct). Its queue job is cancelled and its submit lock
 * freed. If that attempt never reached the submit check, nothing was sent: the run is queued again and starts over from
 * the job URL (the runner is stateless), up to MAX_RESUMES times. If it did, it may have been sent, so it fails with
 * that reason rather than risk a second application. Safe to run from every worker.
 */
export async function reapStaleRuns(staleMinutes = STALE_AFTER_MINUTES) {
  const stale = await db.$queryRaw<Array<{ applicationId: string; jobId: string | null; startedOn: Date }>>`
    SELECT a."id" AS "applicationId", j."id"::text AS "jobId", j.started_on AS "startedOn"
    FROM "Application" a
    JOIN pgboss.job j ON j.name = ANY(${APPLY_QUEUES}) AND j.state = 'active' AND j.data->>'applicationId' = a."id"
    WHERE a."status" IN ('queued', 'inspecting', 'filling', 'needs_input')
      -- The newer of the last heartbeat and this queue job's start: a run that resumes after the user answered keeps the
      -- heartbeat of its earlier attempt until its first beat, and must not be reaped in those first seconds.
      AND GREATEST(a."heartbeatAt", j.started_on) < now() - (${staleMinutes}::int * interval '1 minute')
    UNION ALL
    -- A run left "running" with no queue job alive at all: its job failed or expired because the worker lost the database
    -- mid-run (21 Oct: AiPrise stayed "inspecting" until re-queued by hand). Applications waiting for the user have no job
    -- and are left alone.
    SELECT a."id", NULL, COALESCE((SELECT max(e."createdAt") FROM "ApplicationEvent" e WHERE e."applicationId" = a."id" AND e.type = 'rule_check' AND e.rule = 'start'), a."updatedAt")
    FROM "Application" a
    WHERE a."status" IN ('queued', 'inspecting', 'filling')
      AND GREATEST(a."heartbeatAt", a."updatedAt") < now() - (${staleMinutes}::int * interval '1 minute')
      AND NOT EXISTS (SELECT 1 FROM pgboss.job j WHERE j.name = ANY(${APPLY_QUEUES}) AND j.state IN ('created', 'retry', 'active') AND j.data->>'applicationId' = a."id")`;

  let reaped = 0;
  for (const row of stale) {
    if (row.jobId) await db.$executeRaw`UPDATE pgboss.job SET state = 'cancelled', completed_on = now() WHERE id = ${row.jobId}::uuid AND state = 'active'`;
    await db.$executeRaw`DELETE FROM "SubmitLock" WHERE "holderId" = ${row.applicationId}`;
    // Submit may have gone out once the submit check passed, or once a handoff window sent its submission (a person can
    // press Submit before the agent is ready, which writes "submit_attempt").
    const [reachedSubmit, resumes] = await Promise.all([
      db.applicationEvent.count({ where: { applicationId: row.applicationId, createdAt: { gte: row.startedOn }, OR: [{ type: "rule_check", rule: "submit" }, { type: "submit_attempt" }] } }),
      db.applicationEvent.count({ where: { applicationId: row.applicationId, type: "retry", message: { startsWith: "Picked up again" } } }),
    ]);
    if (reachedSubmit === 0 && resumes < MAX_RESUMES) {
      const requeued = await db.application.updateMany({
        where: { id: row.applicationId, status: { in: ["queued", "inspecting", "filling", "needs_input"] } },
        data: { status: "queued", pendingQuestions: [], verificationCode: null },
      });
      if (requeued.count > 0) {
        await writeEvent(row.applicationId, "retry", "Picked up again after the worker stopped (nothing had been sent)");
        await enqueueApply(row.applicationId);
        reaped += 1;
      }
      continue;
    }
    // Past the submit check, Submit may have been pressed: the outcome is unknown, so it waits for the user to verify it
    // and is never retried (apply/outcome.ts). Before it, nothing was sent and the run simply failed.
    const message = reachedSubmit > 0 ? STALE_AFTER_SUBMIT : STALE_MESSAGE;
    const status = reachedSubmit > 0 ? "pending_verification" : "failed";
    const marked = await db.application.updateMany({
      where: { id: row.applicationId, status: { in: ["queued", "inspecting", "filling", "needs_input"] } },
      data: { status, error: message, pendingQuestions: [], verificationCode: null },
    });
    if (marked.count > 0) {
      await writeEvent(row.applicationId, reachedSubmit > 0 ? "verify" : "error", message);
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
