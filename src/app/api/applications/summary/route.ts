import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * What the shell polls: only the applications waiting for the user, with what each waits for. Small and constant
 * however many applications the user has, unlike the full list.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const waiting = await db.application.findMany({
    where: { userId: user.id, status: "needs_input" },
    orderBy: { createdAt: "desc" },
    select: { id: true, jobId: true, pendingQuestions: true },
  });
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
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
