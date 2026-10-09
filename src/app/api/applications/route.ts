import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const applications = await db.application.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      jobId: true,
      status: true,
      error: true,
      attempt: true,
      submittedAt: true,
      createdAt: true,
      pendingQuestions: true,
    },
  });
  // Which prompt an application is waiting on: the id of its latest "ask_user" event. A new prompt (a rejected
  // security code, a second question) gets a new id, so the client can notify once per prompt and never twice.
  // Place in line is counted over everyone's queued applications (the worker takes them oldest first), so a person who
  // swiped on many jobs can see how long the wait is. The three reads are independent: one round trip.
  const waiting = applications.filter((application) => application.status === "needs_input").map((application) => application.id);
  const [prompts, jobs, waitingInLine] = await Promise.all([
    waiting.length
      ? db.applicationEvent.findMany({
          where: { applicationId: { in: waiting }, type: "ask_user" },
          orderBy: { createdAt: "desc" },
          select: { id: true, applicationId: true },
        })
      : [],
    db.job.findMany({
      where: { id: { in: applications.map((application) => application.jobId) } },
      select: { id: true, title: true, location: true, applyUrl: true, company: { select: { name: true } } },
    }),
    applications.some((application) => application.status === "queued")
      ? db.application.findMany({ where: { status: "queued" }, select: { createdAt: true } })
      : [],
  ]);
  const promptByApp = new Map<string, string>();
  for (const prompt of prompts) if (!promptByApp.has(prompt.applicationId)) promptByApp.set(prompt.applicationId, prompt.id);
  const byId = new Map(jobs.map((job) => [job.id, job]));
  return NextResponse.json(
    {
    applications: applications.map((application) => {
      const job = byId.get(application.jobId);
      const { pendingQuestions, ...rest } = application;
      const asksForCode = Array.isArray(pendingQuestions) && pendingQuestions.some((q) => (q as { key?: string })?.key === "security_code");
      return {
        ...rest,
        waitingFor: application.status === "needs_input" ? (asksForCode ? "code" : "answers") : null,
        promptId: promptByApp.get(application.id) ?? null,
        ahead: application.status === "queued" ? waitingInLine.filter((other) => other.createdAt < application.createdAt).length : null,
        title: job?.title ?? "Unknown role",
        company: job?.company.name ?? "Unknown company",
        location: job?.location ?? "",
      };
    }),
    },
    { headers: NO_STORE },
  );
}
