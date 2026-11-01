import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The applications sent after `since` (ms), for the "Sent!" moment (components/sent-celebration.tsx): the oldest five,
 * with the company, its logo and the role, and the counts the moment can cheer about. One indexed read when none.
 */
async function sentSince(userId: string, since: number) {
  const sent = await db.application.findMany({
    where: { userId, status: "submitted", submittedAt: { gt: new Date(since) } },
    orderBy: { submittedAt: "asc" },
    take: 5,
    select: { id: true, jobId: true, submittedAt: true },
  });
  if (sent.length === 0) return { sent: [], sentTotal: null, sentThisWeek: null };
  const [jobs, sentTotal, sentThisWeek] = await Promise.all([
    db.job.findMany({ where: { id: { in: sent.map((application) => application.jobId) } }, select: { id: true, title: true, company: { select: { name: true, logoUrl: true } } } }),
    db.application.count({ where: { userId, status: "submitted" } }),
    db.application.count({ where: { userId, status: "submitted", submittedAt: { gte: new Date(Date.now() - WEEK_MS) } } }),
  ]);
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  return {
    sent: sent.map((application) => {
      const job = jobById.get(application.jobId);
      return {
        id: application.id,
        company: job?.company.name ?? "the company",
        logoUrl: job?.company.logoUrl ?? null,
        title: job?.title ?? "the role",
        submittedAt: application.submittedAt?.getTime() ?? Date.now(),
      };
    }),
    sentTotal,
    sentThisWeek,
  };
}

/**
 * What the shell polls: the applications waiting for the user, with what each waits for, and (with `?since=`) the
 * ones sent since the last "Sent!" moment. Small and constant however many applications the user has.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sinceParam = Number(new URL(request.url).searchParams.get("since"));
  const [waiting, sent] = await Promise.all([
    db.application.findMany({
      where: { userId: user.id, status: "needs_input" },
      orderBy: { createdAt: "desc" },
      select: { id: true, jobId: true, pendingQuestions: true },
    }),
    Number.isFinite(sinceParam) && sinceParam > 0 ? sentSince(user.id, sinceParam) : Promise.resolve(null),
  ]);
  const ids = waiting.map((application) => application.id);
  const [jobs, prompts] = waiting.length
    ? await Promise.all([
        db.job.findMany({ where: { id: { in: waiting.map((application) => application.jobId) } }, select: { id: true, title: true, company: { select: { name: true } } } }),
        // The latest "ask_user" event per application: a new prompt (a rejected code, a second question) gets a new id.
        db.applicationEvent.findMany({ where: { applicationId: { in: ids }, type: "ask_user" }, orderBy: { createdAt: "desc" }, select: { id: true, applicationId: true } }),
      ])
    : [[], []];
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const promptByApp = new Map<string, string>();
  for (const prompt of prompts) if (!promptByApp.has(prompt.applicationId)) promptByApp.set(prompt.applicationId, prompt.id);

  return NextResponse.json(
    {
      waiting: waiting.map((application) => {
        const job = jobById.get(application.jobId);
        const asksForCode = Array.isArray(application.pendingQuestions) && application.pendingQuestions.some((q) => (q as { key?: string })?.key === "security_code");
        return {
          id: application.id,
          title: job?.title ?? "Unknown role",
          company: job?.company.name ?? "Unknown company",
          waitingFor: asksForCode ? "code" : "answers",
          promptId: promptByApp.get(application.id) ?? null,
        };
      }),
      ...(sent ?? {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
