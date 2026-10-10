import { db } from "@/lib/db";
import { listFeed, parseFeedFilters } from "./match";

const ACTIVE_DAYS = 14;

/**
 * After each ingest the worker builds the default feed of every user active in the last ACTIVE_DAYS (a swipe, an
 * application or a profile change), so the model's verdicts on the new jobs are cached (semantic.ts judgeJobs) and the
 * next feed the user opens only reads them. One user at a time; a failure for one user does not stop the others.
 */
export async function warmFeeds() {
  const since = new Date(Date.now() - ACTIVE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.$queryRaw<Array<{ userId: string }>>`
    SELECT "userId" FROM "Swipe" WHERE "createdAt" >= ${since}
    UNION SELECT "userId" FROM "Application" WHERE "createdAt" >= ${since}
    UNION SELECT "userId" FROM "Profile" WHERE "updatedAt" >= ${since}`;
  let warmed = 0;
  for (const { userId } of rows) {
    try {
      await listFeed(userId, parseFeedFilters({}));
      warmed += 1;
    } catch (error) {
      console.error(`warm feed …${userId.slice(-6)}: ${error instanceof Error ? error.message.slice(0, 80) : "failed"}`);
    }
  }
  return { active: rows.length, warmed };
}
