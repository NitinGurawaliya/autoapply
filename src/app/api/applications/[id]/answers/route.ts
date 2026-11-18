import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { enqueueApply } from "@/lib/queue";
import { db } from "@/lib/db";
import { ONE_TIME_CODE_KEY, upsert } from "@/modules/answers";
import { writeEvent } from "@/modules/governance";

// Matches CODE_WAIT_MS in modules/apply/runner.ts (not imported: the runner pulls Playwright into the web bundle).
const CODE_WAIT_MS = 10 * 60 * 1000;

const bodySchema = z.object({
  answers: z
    .array(
      z.object({
        key: z.string().min(1).max(80),
        answer: z.string().trim().min(1).max(2000),
        // Form labels can be long (a 744-character Okta conflict-of-interest question). The text is only shown on the
        // answers page (answers are matched by a hash of the label), so a long one is shortened, never refused.
        question: z.string().max(5000).optional().transform((text) => text?.slice(0, 1000)),
      }),
    )
    .min(1)
    .max(40),
});

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const application = await db.application.findFirst({
    where: { id, userId: user.id },
    select: { id: true, status: true, updatedAt: true, jobId: true },
  });
  if (!application) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (application.status !== "needs_input") {
    return NextResponse.json({ error: "not_waiting" }, { status: 409 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  // A worker is holding the form open for an emailed code: hand the code over; never store it in the answer bank.
  const code = parsed.data.answers.find((row) => row.key === ONE_TIME_CODE_KEY);
  if (code) {
    const waiting = Date.now() - application.updatedAt.getTime() < CODE_WAIT_MS;
    if (waiting) {
      await db.application.update({
        where: { id: application.id },
        data: { verificationCode: code.answer, status: "filling", pendingQuestions: [] },
      });
      return NextResponse.json({ ok: true, applicationId: application.id });
    }
    await db.application.update({
      where: { id: application.id },
      data: { status: "queued", pendingQuestions: [], error: "Security code expired; starting again" },
    });
    const retryJobId = await enqueueApply(application.id);
    if (!retryJobId) return NextResponse.json({ error: "queue_failed" }, { status: 500 });
    return NextResponse.json({ ok: true, applicationId: application.id, expired: true });
  }

  // The job these answers were given for: a question that depends on the company, city or country is only reused
  // for a job where that matches (modules/apply/recall.ts).
  const job = await db.job.findUnique({ where: { id: application.jobId }, select: { title: true, location: true, country: true, company: { select: { name: true } } } });
  const jobContext = job ? { company: job.company.name, title: job.title, location: job.location, country: job.country } : null;
  try {
    // Together, one per key (the last, as the loop kept): each is a round trip to the database (e2e 18 Nov).
    const rows = [...new Map(parsed.data.answers.map((row) => [row.key, row])).values()];
    await Promise.all(
      rows.map((row) =>
        upsert(user.id, {
          key: row.key,
          question: row.question?.trim() || row.key,
          answer: row.answer,
          source: "user",
          context: jobContext,
        }),
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Which questions the user answered for this application (keys only, never the answers): the runner gives up on a
  // question only when it was answered here twice and still does not fit the form (runner.ts repeatedQuestion).
  // Independent writes go together (e2e verify, 18 Nov: this Save took 2.5 s warm, about 10 sequential round trips).
  await Promise.all([
    writeEvent(application.id, "answer", `You answered ${parsed.data.answers.length} question${parsed.data.answers.length === 1 ? "" : "s"}`, undefined, { keys: parsed.data.answers.map((row) => row.key) }),
    db.application.update({
      where: { id: application.id },
      data: { status: "queued", pendingQuestions: [], error: null },
    }),
  ]);
  // One answer releases every other application waiting on the same question (T56): they run again and use it
  // (anything else they still miss is asked then). One waiting for an emailed code is left alone.
  const answered = new Set(parsed.data.answers.map((row) => row.key));
  const [queueJobId, waiting] = await Promise.all([
    enqueueApply(application.id),
    db.application.findMany({ where: { userId: user.id, status: "needs_input", id: { not: application.id } }, select: { id: true, pendingQuestions: true } }),
  ]);
  if (!queueJobId) return NextResponse.json({ error: "queue_failed" }, { status: 500 });

  const release = waiting.filter((other) => {
    const keys = Array.isArray(other.pendingQuestions) ? other.pendingQuestions.map((question) => (question as { key?: string })?.key) : [];
    return !keys.includes(ONE_TIME_CODE_KEY) && keys.some((key) => key && answered.has(key));
  });
  const sent = await Promise.all(
    release.map(async (other) => {
      await Promise.all([
        db.application.update({ where: { id: other.id }, data: { status: "queued", pendingQuestions: [], error: null } }),
        writeEvent(other.id, "resolve", "Answered on another application; running again"),
      ]);
      return enqueueApply(other.id);
    }),
  );
  const released = sent.filter(Boolean).length;
  return NextResponse.json({ ok: true, applicationId: application.id, queueJobId, released });
}
