import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueApply } from "@/lib/queue";
import { check, historyFor, loadRules, writeEvent } from "@/modules/governance";
import { APPLY_BOARDS, scoreJob } from "@/modules/jobs";

export const CANCELLABLE = ["queued", "inspecting", "filling", "needs_input"];
export const RETRYABLE = ["failed", "cancelled"];

type ScoredProfile = { currentTitle: string | null; skills: unknown; yearsExperience: number | null };
type ScoredJob = { title: string; description: string; country: string; remoteType: string; experienceMin: number | null };

/** The match score the swipe-time rules use: the same for a first swipe and for a retry. */
export function candidateScore(profile: ScoredProfile, job: ScoredJob) {
  return scoreJob(job, {
    currentTitle: profile.currentTitle,
    skills: Array.isArray(profile.skills) ? profile.skills.filter((item): item is string => typeof item === "string") : [],
    yearsExperience: profile.yearsExperience,
    preferredLocations: [],
  }).score;
}

export function boardSupported(source: string) {
  return source === "mock" || (APPLY_BOARDS as readonly string[]).includes(source);
}

/** Stop an application the user owns: it stops within a few seconds even if a browser is open. */
export async function cancelApplication(applicationId: string, userId: string) {
  const marked = await db.application.updateMany({
    where: { id: applicationId, userId, status: { in: CANCELLABLE } },
    data: { status: "cancelled", error: "Cancelled by you", pendingQuestions: [], verificationCode: null },
  });
  if (marked.count === 0) {
    const exists = await db.application.findFirst({ where: { id: applicationId, userId }, select: { id: true } });
    return exists ? ("not_cancellable" as const) : ("not_found" as const);
  }
  await db.$executeRaw`
    UPDATE pgboss.job SET state = 'cancelled', completed_on = now()
    WHERE name = 'apply' AND state IN ('created', 'retry', 'active') AND data->>'applicationId' = ${applicationId}`;
  await db.$executeRaw`DELETE FROM "SubmitLock" WHERE "holderId" = ${applicationId}`;
  await writeEvent(applicationId, "cancel", "Cancelled by you");
  return "cancelled" as const;
}

export type RetryResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_retryable" | "queue_failed" }
  | { ok: false; reason: "blocked"; rule: string };

/** Run a failed or cancelled application again, after the same rules a new swipe has to pass. */
export async function retryApplication(applicationId: string, userId: string): Promise<RetryResult> {
  const application = await db.application.findFirst({ where: { id: applicationId, userId } });
  if (!application) return { ok: false, reason: "not_found" };
  if (!RETRYABLE.includes(application.status)) return { ok: false, reason: "not_retryable" };

  const [job, profile] = await Promise.all([
    db.job.findUnique({ where: { id: application.jobId } }),
    db.profile.findUnique({ where: { userId } }),
  ]);
  if (!job || !profile) return { ok: false, reason: "blocked", rule: "profile_required" };
  if (job.closedAt) return { ok: false, reason: "blocked", rule: "job_closed" };
  if (!boardSupported(job.source)) return { ok: false, reason: "blocked", rule: "board_not_supported" };

  // This application is failed or cancelled, so it does not count against itself in the history.
  const history = await historyFor(userId, { title: job.title, companyId: job.companyId });
  const decision = await check("swipe_right", {
    applicationId,
    profileExists: true,
    score: candidateScore(profile, job),
    applicationsToday: history.applicationsToday,
    duplicateRole: history.duplicateRole,
    companyWeekCount: history.companyWeekCount,
    inFlight: history.inFlight,
  });
  if (!decision.ok) return { ok: false, reason: "blocked", rule: decision.rule ?? "blocked" };

  const claimed = await db.application.updateMany({
    where: { id: applicationId, userId, status: { in: RETRYABLE } },
    data: { status: "queued", error: null, attempt: 0, pendingQuestions: [], verificationCode: null, heartbeatAt: null },
  });
  if (claimed.count === 0) return { ok: false, reason: "not_retryable" };
  const queued = await enqueueApply(applicationId);
  if (!queued) {
    await db.application.update({ where: { id: applicationId }, data: { status: "failed", error: "Could not queue the retry" } });
    return { ok: false, reason: "queue_failed" };
  }
  await writeEvent(applicationId, "retry", "Retried by you");
  return { ok: true };
}

class QueueFull extends Error {}

export type SwipeResult =
  | { ok: true; applicationId: string }
  | { ok: false; reason: "not_found" | "already_swiped" | "profile_required" | "queue_failed" }
  | { ok: false; reason: "blocked"; rule: string; applicationId?: string };

/**
 * A right swipe: one place for every rule, so swiping fast on many jobs behaves the same as swiping on one.
 * A swipe refused because the queue is full is not recorded at all, so the job stays in the feed to swipe again later.
 */
export async function swipeRight(userId: string, jobId: string, enqueue: (applicationId: string) => Promise<string | null> = enqueueApply): Promise<SwipeResult> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) return { ok: false, reason: "not_found" };
  if (await db.swipe.findUnique({ where: { userId_jobId: { userId, jobId } } })) return { ok: false, reason: "already_swiped" };
  const profile = await db.profile.findUnique({ where: { userId } });
  if (!profile) return { ok: false, reason: "profile_required" };
  if (job.closedAt) return { ok: false, reason: "blocked", rule: "job_closed" };
  if (!boardSupported(job.source)) return { ok: false, reason: "blocked", rule: "board_not_supported" };

  let application;
  let history;
  try {
    ({ application, history } = await db.$transaction(async (tx) => {
      // Many swipes at once must not each see room under a limit: one at a time per person, and every count the rules
      // use (queue, today's total, this company this week, duplicate role) is read under the lock, so a burst of
      // swipes cannot pass the daily or company cap together.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const counts = await historyFor(userId, { title: job.title, companyId: job.companyId }, new Date(), tx);
      if (counts.inFlight >= loadRules().max_in_flight_per_user) throw new QueueFull();
      await tx.swipe.create({ data: { userId, jobId, direction: "right" } });
      const created = await tx.application.create({ data: { userId, jobId, status: "queued", fields: [], pendingQuestions: [] } });
      return { application: created, history: counts };
    }, { maxWait: 60000, timeout: 60000 }));
  } catch (error) {
    if (error instanceof QueueFull) return { ok: false, reason: "blocked", rule: "max_in_flight" };
    // Two swipes on the same job at once: the unique key lets exactly one through. Anything else is a real error.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, reason: "already_swiped" };
    throw error;
  }

  const decision = await check("swipe_right", {
    applicationId: application.id,
    profileExists: true,
    score: candidateScore(profile, job),
    applicationsToday: history.applicationsToday,
    duplicateRole: history.duplicateRole,
    companyWeekCount: history.companyWeekCount,
    inFlight: history.inFlight,
  });
  if (!decision.ok) {
    await db.application.update({ where: { id: application.id }, data: { status: "blocked", error: decision.rule } });
    return { ok: false, reason: "blocked", rule: decision.rule ?? "blocked", applicationId: application.id };
  }
  const queued = await enqueue(application.id);
  if (!queued) {
    await db.application.update({ where: { id: application.id }, data: { status: "failed", error: "Could not queue the application" } });
    return { ok: false, reason: "queue_failed" };
  }
  return { ok: true, applicationId: application.id };
}
