import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { dropFromFeed, forgetFeed } from "@/lib/feed-cache";
import { learnFromSkips, recordReason, SKIP_REASONS } from "@/modules/profile";

const bodySchema = z.object({ reason: z.enum(SKIP_REASONS) });

/**
 * Why a left swipe was made (P8, the deck's "Why?" row). Upserts the left swipe, so it works before the deck's own
 * POST lands (that POST then gets a 409 and skips its drop, so the drop is done here); a right swipe is never changed.
 * No forgetFeed: a reason does not rebuild the feed, unless it made a learned line (a rank change). Answers with the
 * one question the skips now ask, if any.
 */
export async function PATCH(req: Request, context: { params: Promise<{ jobId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { jobId } = await context.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { saved, counts } = await recordReason(user.id, jobId, parsed.data.reason);
  if (saved === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (saved === "not_left") return NextResponse.json({ error: "applied" }, { status: 409 });
  dropFromFeed(user.id, jobId);
  if (!counts) return NextResponse.json({ ok: true, ask: null });

  const { ask, learned } = await learnFromSkips(user.id).catch(() => ({ ask: null, learned: false }));
  if (learned) forgetFeed(user.id);
  return NextResponse.json({ ok: true, ask });
}
