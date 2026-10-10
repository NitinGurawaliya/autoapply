import { db } from "@/lib/db";
import { sendPush } from "@/lib/push";
import { listFeed, parseFeedFilters } from "./match";

const ACTIVE_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

/**
 * After each ingest the worker builds the default feed of every user active in the last ACTIVE_DAYS (a swipe, an
 * application or a profile change) and of every user with browser push on, so the model's verdicts on the new jobs are
 * cached (semantic.ts judgeJobs) and the next feed only reads them. Then the retention hook: a user with push on gets
 * one message when their feed has Strong or Good matches first seen since their last one ("3 new jobs for you").
 * One user at a time; a failure for one user does not stop the others.
 */
export async function warmFeeds() {
  const since = new Date(Date.now() - ACTIVE_DAYS * DAY);
  const rows = await db.$queryRaw<Array<{ userId: string }>>`
    SELECT "userId" FROM "Swipe" WHERE "createdAt" >= ${since}
    UNION SELECT "userId" FROM "Application" WHERE "createdAt" >= ${since}
    UNION SELECT "userId" FROM "Profile" WHERE "updatedAt" >= ${since}
    UNION SELECT "userId" FROM "PushSubscription"`;
  let warmed = 0;
  let alerted = 0;
  for (const { userId } of rows) {
    try {
      const feed = await listFeed(userId, parseFeedFilters({}));
      warmed += 1;
      if (await alertNewMatches(userId, feed)) alerted += 1;
    } catch (error) {
      console.error(`warm feed …${userId.slice(-6)}: ${error instanceof Error ? error.message.slice(0, 80) : "failed"}`);
    }
  }
  return { active: rows.length, warmed, alerted };
}

/** One push for the Strong and Good jobs first seen since the user's last alert (or the last day); true when sent. */
export async function alertNewMatches(userId: string, feed: Awaited<ReturnType<typeof listFeed>>) {
  const [user, subscriptions] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { matchesAlertedAt: true } }),
    db.pushSubscription.count({ where: { userId } }),
  ]);
  if (!user || subscriptions === 0) return false;
  const after = user.matchesAlertedAt ?? new Date(Date.now() - DAY);
  const good = feed.filter((job) => job.tier === "strong" || job.tier === "good");
  if (good.length === 0) return false;
  const seen = await db.job.findMany({ where: { id: { in: good.map((job) => job.id) }, firstSeenAt: { gt: after } }, select: { id: true, firstSeenAt: true } });
  if (seen.length === 0) return false;
  const fresh = new Set(seen.map((job) => job.id));
  const jobs = good.filter((job) => fresh.has(job.id));
  const names = jobs.slice(0, 2).map((job) => `${job.title} at ${job.company}`);
  const more = jobs.length - names.length;
  const sent = await sendPush(userId, {
    title: jobs.length === 1 ? "A new job matches your resume" : `${jobs.length} new jobs match your resume`,
    body: `${names.join("; ")}${more > 0 ? ` and ${more} more` : ""}`,
    url: "/feed",
    tag: "new-matches",
  });
  if (sent === 0) return false;
  const newest = seen.reduce((latest, job) => (job.firstSeenAt > latest ? job.firstSeenAt : latest), after);
  await db.user.update({ where: { id: userId }, data: { matchesAlertedAt: newest } });
  return true;
}
