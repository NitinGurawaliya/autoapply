import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { revealApplicationPassword } from "@/modules/accounts";

/**
 * Phase U, U1: the password the agent uses for the signed-in user's employer accounts (Workday and the others), shown to
 * them alone so they can sign in to those accounts themselves. Made on first ask when none exists yet. POST, so it is
 * never cached or prefetched; rate-limited; never logged.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limit = await rateLimit(`reveal:${user.id}`, 20, 3600);
  if (!limit.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const password = await revealApplicationPassword(user.id);
  if (!password) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  return NextResponse.json({ password }, { headers: { "Cache-Control": "no-store" } });
}
