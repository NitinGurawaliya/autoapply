import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { siteListed } from "@/lib/site-flags";
import { isSite, startConnect } from "@/modules/sources";

// The user accepted the account-risk notice: a window opens on their computer for them to sign in themselves.
const bodySchema = z.object({ consent: z.literal(true) });

const REFUSALS = {
  test_profile: { status: 403, error: "test_profile_mock_only" },
  no_profile: { status: 409, error: "profile_required" },
  no_screen_worker: { status: 409, error: "no_screen_worker" },
  already_connecting: { status: 409, error: "already_connecting" },
  queue_failed: { status: 503, error: "queue_failed" },
} as const;

export async function POST(req: Request, context: { params: Promise<{ site: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { site } = await context.params;
  if (!isSite(site) || !siteListed(site)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "consent_required" }, { status: 400 });
  const limit = await rateLimit(`source-connect:${user.id}`, 6, 3600);
  if (!limit.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const result = await startConnect(user.id, site);
  if (!result.ok) {
    const refusal = REFUSALS[result.reason];
    return NextResponse.json({ error: refusal.error }, { status: refusal.status });
  }
  return NextResponse.json({ status: "connecting" }, { status: 202 });
}
