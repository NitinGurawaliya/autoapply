import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { swipeRight } from "@/modules/apply/lifecycle";

const bodySchema = z.object({
  jobId: z.string().min(1),
  direction: z.enum(["left", "right"]),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { jobId, direction } = parsed.data;

  if (direction === "left") {
    const job = await db.job.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
    try {
      await db.swipe.create({ data: { userId: user.id, jobId, direction: "left" } });
    } catch {
      return NextResponse.json({ error: "already_swiped" }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  }

  const result = await swipeRight(user.id, jobId);
  if (result.ok) return NextResponse.json({ ok: true, applicationId: result.applicationId });
  if (result.reason === "blocked") {
    // A full queue is a "try again later", not a refusal: nothing was saved and the card goes back to the deck.
    if (result.rule === "max_in_flight") return NextResponse.json({ ok: false, blocked: "max_in_flight" }, { status: 429 });
    return NextResponse.json({ ok: false, applicationId: result.applicationId, blocked: result.rule }, { status: 403 });
  }
  if (result.reason === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (result.reason === "already_swiped") return NextResponse.json({ error: "already_swiped" }, { status: 409 });
  if (result.reason === "profile_required") return NextResponse.json({ error: "profile_required" }, { status: 400 });
  return NextResponse.json({ error: "queue_failed" }, { status: 500 });
}
