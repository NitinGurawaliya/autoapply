import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueApply } from "@/lib/queue";
import { APPLY_BOARDS, scoreJob } from "@/modules/jobs";
import { check } from "@/modules/governance";

const bodySchema = z.object({
  jobId: z.string().min(1),
  direction: z.enum(["left", "right"]),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const job = await db.job.findUnique({ where: { id: parsed.data.jobId } });
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const existing = await db.swipe.findUnique({
    where: { userId_jobId: { userId: user.id, jobId: job.id } },
  });
  if (existing) return NextResponse.json({ error: "already_swiped" }, { status: 409 });

  if (parsed.data.direction === "left") {
    await db.swipe.create({
      data: { userId: user.id, jobId: job.id, direction: "left" },
    });
    return NextResponse.json({ ok: true });
  }

  const profile = await db.profile.findUnique({ where: { userId: user.id } });
  if (!profile) return NextResponse.json({ error: "profile_required" }, { status: 400 });
  if (job.source !== "mock" && !(APPLY_BOARDS as readonly string[]).includes(job.source)) {
    return NextResponse.json({ ok: false, blocked: "board_not_supported" }, { status: 403 });
  }

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const applicationsToday = await db.application.count({
    where: { userId: user.id, createdAt: { gte: dayStart } },
  });
  const score = scoreJob(job, {
    currentTitle: profile.currentTitle,
    skills: Array.isArray(profile.skills) ? profile.skills.filter((item) => typeof item === "string") : [],
    yearsExperience: profile.yearsExperience,
    preferredLocations: [],
  }).score;

  const application = await db.$transaction(async (tx) => {
    await tx.swipe.create({
      data: { userId: user.id, jobId: job.id, direction: "right" },
    });
    return tx.application.create({
      data: {
        userId: user.id,
        jobId: job.id,
        status: "queued",
        fields: [],
        pendingQuestions: [],
      },
    });
  });

  const decision = await check("swipe_right", {
    applicationId: application.id,
    profileExists: true,
    score,
    applicationsToday,
  });
  if (!decision.ok) {
    await db.application.update({
      where: { id: application.id },
      data: { status: "blocked", error: decision.rule },
    });
    return NextResponse.json({ ok: false, applicationId: application.id, blocked: decision.rule }, { status: 403 });
  }

  const queueJobId = await enqueueApply(application.id);
  if (!queueJobId) return NextResponse.json({ error: "queue_failed" }, { status: 500 });

  return NextResponse.json({
    ok: true,
    applicationId: application.id,
    queueJobId,
  });
}
