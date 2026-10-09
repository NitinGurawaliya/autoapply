import { db } from "@/lib/db";
import { startOfTodayUtc } from "./history";
import { loadRules } from "./rules";

const NOISE = ["fill"];

/** What the governance page shows one user: their counters for today (UTC) and their latest decisions. */
export async function governanceOverview(userId: string) {
  const since = startOfTodayUtc();
  const mine = { application: { userId } };
  const [started, submitted, blockedEvents, asked, checks, events, blocks] = await Promise.all([
    db.application.count({ where: { userId, createdAt: { gte: since } } }),
    db.application.count({ where: { userId, submittedAt: { gte: since } } }),
    db.applicationEvent.count({ where: { ...mine, type: "block", createdAt: { gte: since } } }),
    db.applicationEvent.count({ where: { ...mine, type: "ask_user", createdAt: { gte: since } } }),
    // A check that blocked is still a check that ran, so passes and blocks both count.
    db.applicationEvent.count({ where: { ...mine, type: { in: ["rule_check", "block"] }, createdAt: { gte: since } } }),
    db.applicationEvent.findMany({
      where: { ...mine, type: { notIn: NOISE } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, type: true, message: true, rule: true, createdAt: true, applicationId: true },
    }),
    db.applicationEvent.findMany({
      where: { ...mine, type: "block" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, rule: true, message: true, createdAt: true, applicationId: true },
    }),
  ]);

  const ids = [...new Set([...events, ...blocks].map((event) => event.applicationId))];
  const apps = await db.application.findMany({ where: { id: { in: ids }, userId }, select: { id: true, jobId: true } });
  const jobs = await db.job.findMany({ where: { id: { in: apps.map((app) => app.jobId) } }, select: { id: true, title: true, company: { select: { name: true } } } });
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const appJob = new Map(apps.map((app) => [app.id, jobById.get(app.jobId)]));
  const label = (applicationId: string) => {
    const job = appJob.get(applicationId);
    return job ? { company: job.company.name, title: job.title } : { company: "Unknown company", title: "Unknown role" };
  };

  const rules = loadRules();
  return {
    rules,
    counters: { started, cap: rules.max_applications_per_day, submitted, blocked: blockedEvents, asked, checks },
    events: events.map((event) => ({ ...event, ...label(event.applicationId) })),
    blocks: blocks.map((event) => ({ ...event, ...label(event.applicationId) })),
  };
}
