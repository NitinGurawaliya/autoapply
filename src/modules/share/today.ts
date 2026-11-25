import { db } from "@/lib/db";

/**
 * How many of today's picks the user has not swiped yet, for the arrival card (Phase U5): null when today's set is not
 * built (a new user's first set builds on the feed's first load, behind the reading scene, Phase R4).
 */
export async function todaysPicksLeft(userId: string): Promise<number | null> {
  const [set] = await db.$queryRaw<Array<{ jobIds: string[] }>>`
    SELECT "jobIds" FROM "DailySet" WHERE "userId" = ${userId} AND "day" = (now() AT TIME ZONE 'Asia/Kolkata')::date`;
  if (!set) return null;
  const swiped = set.jobIds.length === 0 ? 0 : await db.swipe.count({ where: { userId, jobId: { in: set.jobIds } } });
  return Math.max(0, set.jobIds.length - swiped);
}
