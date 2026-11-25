import { cachedFeedScore } from "@/lib/feed-cache";
import { db } from "@/lib/db";
// From lifecycle, never the apply index: the index loads the browser and the runner, which a web server can't
// (on Vercel that made every route importing this module a 500, 23 Nov).
import { candidateScore } from "@/modules/apply/lifecycle";

/**
 * The match score a signed-in user with a profile sees on a share page (Phase U): the number their feed showed when
 * it still holds the job, else the one a swipe would check (`candidateScore`), so the page and the Apply agree.
 * Null without a profile or when the score cannot be worked out.
 */
export async function shareMatchScore(userId: string, jobId: string): Promise<number | null> {
  const seen = cachedFeedScore(userId, jobId);
  if (seen != null) return seen;
  const [profile, job] = await Promise.all([
    db.profile.findUnique({ where: { userId } }),
    db.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        title: true,
        description: true,
        contentHash: true,
        country: true,
        remoteType: true,
        experienceMin: true,
        track: true,
        seniority: true,
        skills: true,
        skillsRequired: true,
        skillsHash: true,
        source: true,
        roleFamily: true,
        kind: true,
        flags: true,
        readingCurrent: true,
      },
    }),
  ]);
  if (!profile || !job) return null;
  try {
    return await candidateScore(profile, job);
  } catch {
    return null;
  }
}
