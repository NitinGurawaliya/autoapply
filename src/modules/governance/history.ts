import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/** The shared client, or a transaction's (so swipe-time counts can be read under the swipe's lock). */
type Reader = typeof db | Prisma.TransactionClient;

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

export async function dailyUsage(userId: string, client: Reader = db) {
  return client.application.count({ where: { userId, createdAt: { gte: startOfTodayUtc() } } });
}

/** This user's counted applications with their job title and company name, in one round trip (a join, not two reads). */
async function countedApplications(userId: string, client: Reader = db) {
  return client.$queryRaw<Array<{ title: string; companyName: string; createdAt: Date }>>`
    SELECT j."title" AS "title", c."name" AS "companyName", a."createdAt" AS "createdAt"
    FROM "Application" a
    JOIN "Job" j ON j."id" = a."jobId"
    JOIN "Company" c ON c."id" = j."companyId"
    WHERE a."userId" = ${userId} AND a."status" = ANY(${COUNTED})`;
}

/** Roles this user has already applied to (or is applying to), as roleKey values. */
export async function appliedRoleKeys(userId: string) {
  const apps = await countedApplications(userId);
  return new Set(apps.map((app) => roleKey(companyKey(app.companyName), app.title)));
}

/** What the swipe-time rules need to know about this user's history with one job's role and company. */
export async function historyFor(userId: string, job: { title: string; companyId: string }, now = new Date(), client: Reader = db) {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  // Independent reads, so one round trip instead of five.
  const [apps, company, inFlight, applicationsToday] = await Promise.all([
    countedApplications(userId, client),
    client.company.findUnique({ where: { id: job.companyId }, select: { name: true } }),
    // Applications that are using, or waiting for, the shared worker. A user parked on a question is not one of them.
    client.application.count({ where: { userId, status: { in: ["queued", "inspecting", "filling"] } } }),
    dailyUsage(userId, client),
  ]);
  const thisCompany = companyKey(company?.name ?? job.companyId);
  const key = roleKey(thisCompany, job.title);
  let duplicateRole = false;
  let companyWeekCount = 0;
  for (const app of apps) {
    if (companyKey(app.companyName) !== thisCompany) continue;
    if (roleKey(thisCompany, app.title) === key) duplicateRole = true;
    if (app.createdAt >= weekAgo) companyWeekCount += 1;
  }
  return { duplicateRole, companyWeekCount, applicationsToday, inFlight };
}
