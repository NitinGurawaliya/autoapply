import { db } from "@/lib/db";
import { swipeRight } from "@/modules/apply/lifecycle";
import { candidateShows } from "@/modules/jobs";

/**
 * Handing a shared job to the agent (Phase U5, docs/share/TDD.md §4.3 steps 6–7). The Apply tap is the right swipe:
 * `swipeRight` writes the Swipe row and runs every governance check, unchanged. A job already swiped answers with its
 * application, so a reload or a second device never applies twice.
 */

export type ClaimResult =
  | { ok: true; applicationId: string; already: boolean }
  | { ok: false; reason: "blocked"; rule: string; applicationId?: string }
  | { ok: false; reason: "not_found" | "profile_required" | "queue_failed" };

type Enqueue = Parameters<typeof swipeRight>[2];

export async function claimShare(userId: string, jobId: string, enqueue?: Enqueue): Promise<ClaimResult> {
  const result = await swipeRight(userId, jobId, enqueue);
  if (result.ok) return { ok: true, applicationId: result.applicationId, already: false };
  if (result.reason === "blocked") return result;
  if (result.reason !== "already_swiped") return { ok: false, reason: result.reason };
  const application = await db.application.findFirst({ where: { userId, jobId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, error: true } });
  if (!application) return { ok: false, reason: "blocked", rule: "no_duplicate_role" };
  if (application.status === "blocked") return { ok: false, reason: "blocked", rule: application.error ?? "blocked", applicationId: application.id };
  return { ok: true, applicationId: application.id, already: true };
}

export type ShareOutcome = {
  applicationId: string;
  status: string;
  /** The governance rule that stopped it, for a blocked application. */
  rule: string | null;
  /** For a score block: the job's required skills the resume doesn't show (up to three). */
  missing: string[];
};

/** What already happened to this job for this user: their latest application to it, or null. */
export async function shareOutcome(userId: string, jobId: string): Promise<ShareOutcome | null> {
  const application = await db.application.findFirst({ where: { userId, jobId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, error: true } });
  if (!application) return null;
  const rule = application.status === "blocked" ? (application.error ?? "blocked") : null;
  let missing: string[] = [];
  if (rule === "min_match_score") {
    const [job, profile] = await Promise.all([
      db.job.findUnique({ where: { id: jobId }, select: { skillsRequired: true } }),
      db.profile.findUnique({ where: { userId }, select: { skills: true, resumeText: true } }),
    ]);
    if (job && profile) {
      const shows = new Set([...candidateShows(profile)].map((skill) => skill.toLowerCase()));
      missing = job.skillsRequired.filter((skill) => !shows.has(skill.toLowerCase())).slice(0, 3);
    }
  }
  return { applicationId: application.id, status: application.status, rule, missing };
}
