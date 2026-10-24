import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// What is still moving (needs the user, or the agent is on it) is always returned in full: it is bounded by the queue
// cap and is what the user came to see. Finished applications (sent, or did not go through) come a page at a time,
// newest first, so the list stays small however many a user has.
// Listed first, unpaged: everything that is moving or waits for the user (pending_verification: "Check your email").
const ACTIVE = ["needs_input", "pending_verification", "queued", "inspecting", "filling"];
const FINISHED: Record<string, string[]> = { all: ["submitted", "failed", "blocked", "cancelled"], sent: ["submitted"], failed: ["failed", "blocked", "cancelled"] };
const PAGE = 25;

const SELECT = { id: true, jobId: true, status: true, error: true, attempt: true, submittedAt: true, createdAt: true, updatedAt: true, pendingQuestions: true } as const;

/** "createdAt_id" of the last finished row of a page: the next page starts after it. */
function readCursor(raw: string | null) {
  const match = raw?.match(/^(\d{4}-\d\d-\d\dT[\d:.]+Z)_(\w+)$/);
  return match ? { updatedAt: new Date(match[1]), id: match[2] } : null;
}

/**
 * GET /api/applications?group=all|sent|failed&cursor=… The first page (no cursor) has every active application, the
 * newest finished ones, and the counts per status for the filter chips; later pages have finished ones only.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const finished = FINISHED[params.get("group") ?? "all"] ?? FINISHED.all;
  const cursor = readCursor(params.get("cursor"));
  const userId = user.id;

  const [active, page, byStatus] = await Promise.all([
    cursor ? [] : db.application.findMany({ where: { userId, status: { in: ACTIVE } }, orderBy: { createdAt: "desc" }, select: SELECT }),
    db.application.findMany({
      where: {
        userId,
        status: { in: finished },
        ...(cursor ? { OR: [{ updatedAt: { lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] } : {}),
      },
      // Latest outcome first (21 Oct: applications re-run and sent today were listed under the day they were first
      // swiped, below today's new ones, and looked missing from Sent).
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: PAGE + 1,
      select: SELECT,
    }),
    cursor ? [] : db.application.groupBy({ by: ["status"], where: { userId }, _count: true }),
  ]);
  const more = page.length > PAGE;
  const finishedRows = page.slice(0, PAGE);
  const last = finishedRows[finishedRows.length - 1];
  const applications = [...active, ...finishedRows];

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
      select: { id: true, title: true, location: true, applyUrl: true, company: { select: { name: true, logoUrl: true } } },
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
          logoUrl: job?.company.logoUrl ?? null,
          location: job?.location ?? "",
        };
      }),
      // Counts per status over all the user's applications (first page only), so the chips stay right while pages load.
      counts: cursor ? null : Object.fromEntries(byStatus.map((row) => [row.status, row._count])),
      nextCursor: more && last ? `${last.updatedAt.toISOString()}_${last.id}` : null,
    },
    { headers: NO_STORE },
  );
}
