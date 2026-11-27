import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { createLinkCode, linkStatus, unlink, whatsappEnabled } from "@/modules/whatsapp";

// Phase Y, Y2 (docs/whatsapp/TDD.md 4.5, 6): the Account card's link. Every route is scoped to the signed-in user.
export const dynamic = "force-dynamic";

async function signedIn() {
  const user = await getCurrentUser();
  return user ? { user } : { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
}

/** A fresh code and the wa.me link with "Join <code>" typed in. */
export async function POST() {
  const session = await signedIn();
  if (!session.user) return session.response;
  if (!whatsappEnabled()) return NextResponse.json({ error: "disabled" }, { status: 503 });
  const limit = await rateLimit(`wa-link:${session.user.id}`, 10, 3600);
  if (!limit.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const made = await createLinkCode(session.user.id);
  if (!made.url) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  return NextResponse.json({ url: made.url, code: made.code, expiresAt: made.expiresAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
}

/** What the card shows; the card polls it while waiting for the user's message. The number is masked. */
export async function GET() {
  const session = await signedIn();
  if (!session.user) return session.response;
  if (!whatsappEnabled()) return NextResponse.json({ error: "disabled" }, { status: 503 });
  return NextResponse.json(await linkStatus(session.user.id), { headers: { "Cache-Control": "no-store" } });
}

/** Unlink: the row, and with it the number, is deleted at once. */
export async function DELETE() {
  const session = await signedIn();
  if (!session.user) return session.response;
  if (!whatsappEnabled()) return NextResponse.json({ error: "disabled" }, { status: 503 });
  await unlink(session.user.id);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
