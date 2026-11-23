import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { clearShareIntent, readShareIntent } from "@/lib/share-intent";
import { shareLinksEnabled } from "@/lib/share-gate";
import { claimShare, trackShareStep } from "@/modules/share";

const bodySchema = z.object({ jobId: z.string().regex(/^[a-z0-9]{20,40}$/).optional(), auto: z.boolean().optional() }).catch({});

/**
 * POST /api/share/claim (Phase U5, docs/share/TDD.md §6): hand a shared job to the agent. The job id comes from the
 * body (an Apply tap) or else the intent cookie (back from Google or onboarding). The intent is cleared in every
 * outcome except a failed queue, so Try again can still find it.
 */
export async function POST(request: Request) {
  if (!shareLinksEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = bodySchema.parse(await request.json().catch(() => ({})));
  const jobId = body.jobId ?? (await readShareIntent());
  if (!jobId) return NextResponse.json({ error: "no_job" }, { status: 400 });

  // The funnel (U7): a tap here is a profile user's Apply; one made on load was tapped before Google or onboarding.
  if (body.jobId && !body.auto) await trackShareStep("apply_tap", { jobId, userId: user.id });
  const result = await claimShare(user.id, jobId);
  if (result.ok && !result.already) await trackShareStep("queued", { jobId, userId: user.id, detail: result.applicationId });
  if (!result.ok && result.reason === "blocked") await trackShareStep("blocked", { jobId, userId: user.id, detail: result.rule });
  if (!(result.ok === false && result.reason === "queue_failed")) await clearShareIntent();

  if (result.ok) return NextResponse.json({ applicationId: result.applicationId, already: result.already });
  if (result.reason === "blocked") return NextResponse.json({ blocked: result.rule, applicationId: result.applicationId ?? null }, { status: 403 });
  if (result.reason === "profile_required") return NextResponse.json({ error: "profile_required" }, { status: 400 });
  if (result.reason === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ error: "queue_failed" }, { status: 500 });
}
