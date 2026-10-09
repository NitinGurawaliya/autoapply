import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { CANCELLABLE, cancelApplication } from "@/modules/apply/lifecycle";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Everything stored about the user that the app can show them, as plain JSON. */
export async function exportAccount(userId: string) {
  const [user, profile, answers, applications, swipes] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { email: true, name: true, createdAt: true } }),
    db.profile.findUnique({ where: { userId } }),
    db.answer.findMany({ where: { userId }, orderBy: { key: "asc" }, select: { key: true, question: true, answer: true, source: true, updatedAt: true } }),
    db.application.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, jobId: true, status: true, error: true, fields: true, createdAt: true, submittedAt: true, events: { orderBy: { createdAt: "asc" }, select: { type: true, message: true, rule: true, createdAt: true } } },
    }),
    db.swipe.count({ where: { userId } }),
  ]);
  const jobs = await db.job.findMany({ where: { id: { in: applications.map((a) => a.jobId) } }, select: { id: true, title: true, applyUrl: true, company: { select: { name: true } } } });
  const byId = new Map(jobs.map((job) => [job.id, job]));
  return {
    exportedAt: new Date().toISOString(),
    account: user,
    profile: profile && {
      fullName: profile.fullName, email: profile.email, phone: profile.phone, city: profile.city, country: profile.country,
      linkedin: profile.linkedin, github: profile.github, portfolio: profile.portfolio, yearsExperience: profile.yearsExperience,
      currentTitle: profile.currentTitle, currentCompany: profile.currentCompany, skills: profile.skills, experience: profile.experience, education: profile.education,
    },
    answers,
    swipes,
    applications: applications.map(({ jobId, ...application }) => ({
      ...application,
      job: byId.get(jobId) ? { title: byId.get(jobId)!.title, company: byId.get(jobId)!.company.name, url: byId.get(jobId)!.applyUrl } : null,
    })),
  };
}

/**
 * Erases the user and everything tied to them. Deleting the user row cascades the profile, answers, swipes,
 * applications and events; this also removes what has no link to it: stored files, locks, rate counters and queue jobs.
 * Browser profile folders live on the worker's disk, so the worker removes those (see worker/reaper.ts).
 */
export async function deleteAccount(userId: string) {
  const applications = await db.application.findMany({ where: { userId }, select: { id: true, status: true } });
  // Stop anything still running first, so no browser keeps filling a form for someone who has left.
  let stopped = 0;
  for (const application of applications) {
    if (CANCELLABLE.includes(application.status) && (await cancelApplication(application.id, userId)) === "cancelled") stopped += 1;
  }
  if (stopped > 0) await sleep(3000);

  const ids = applications.map((application) => application.id);
  if (ids.length > 0) {
    await db.$executeRaw`UPDATE pgboss.job SET state = 'cancelled', completed_on = now() WHERE name = 'apply' AND state IN ('created', 'retry', 'active') AND data->>'applicationId' = ANY(${ids})`;
    await db.$executeRaw`DELETE FROM "SubmitLock" WHERE "holderId" = ANY(${ids})`;
  }
  await db.$executeRaw`DELETE FROM "SubmitLock" WHERE "userId" = ${userId}`;
  await db.$executeRaw`DELETE FROM "RateEvent" WHERE "key" LIKE ${`%:${userId}`}`;
  const files = await storage.deleteForUser(userId);
  await db.user.delete({ where: { id: userId } });
  return { applications: ids.length, files };
}
