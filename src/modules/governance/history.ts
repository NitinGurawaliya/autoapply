import { db } from "@/lib/db";

// Applications that still count against the user: sent, or on their way. Failed, blocked and cancelled ones do not.
const COUNTED = ["submitted", "queued", "inspecting", "filling", "needs_input"];

/** A company is its name, lower-cased and stripped, so one company listed on two job boards is still one company. */
export function companyKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Same company and same normalised title is the same role, even when two boards list it under different ids. */
export function roleKey(company: string, title: string) {
  const normalised = title
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
  return `${company}|${normalised}`;
}

export function startOfTodayUtc() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export async function dailyUsage(userId: string) {
  return db.application.count({ where: { userId, createdAt: { gte: startOfTodayUtc() } } });
}

/** Roles this user has already applied to (or is applying to), as roleKey values. */
export async function appliedRoleKeys(userId: string) {
  const apps = await db.application.findMany({
    where: { userId, status: { in: COUNTED } },
    select: { jobId: true, createdAt: true },
  });
  const jobs = await db.job.findMany({
    where: { id: { in: apps.map((app) => app.jobId) } },
    select: { id: true, title: true, company: { select: { name: true } } },
  });
  return new Set(jobs.map((job) => roleKey(companyKey(job.company.name), job.title)));
}

/** What the swipe-time rules need to know about this user's history with one job's role and company. */
export async function historyFor(userId: string, job: { title: string; companyId: string }, now = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const apps = await db.application.findMany({
    where: { userId, status: { in: COUNTED } },
    select: { jobId: true, createdAt: true },
  });
  const jobs = await db.job.findMany({
    where: { id: { in: apps.map((app) => app.jobId) } },
    select: { id: true, title: true, company: { select: { name: true } } },
  });
  const byId = new Map(jobs.map((item) => [item.id, item]));
  const thisCompany = companyKey((await db.company.findUnique({ where: { id: job.companyId }, select: { name: true } }))?.name ?? job.companyId);
  const key = roleKey(thisCompany, job.title);
  let duplicateRole = false;
  let companyWeekCount = 0;
  for (const app of apps) {
    const known = byId.get(app.jobId);
    if (!known || companyKey(known.company.name) !== thisCompany) continue;
    if (roleKey(thisCompany, known.title) === key) duplicateRole = true;
    if (app.createdAt >= weekAgo) companyWeekCount += 1;
  }
  // Applications that are using, or waiting for, the shared worker. A user parked on a question is not one of them.
  const inFlight = await db.application.count({ where: { userId, status: { in: ["queued", "inspecting", "filling"] } } });
  return { duplicateRole, companyWeekCount, applicationsToday: await dailyUsage(userId), inFlight };
}
