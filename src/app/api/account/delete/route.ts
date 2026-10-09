import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { deleteAccount } from "@/modules/account";

const CONFIRM_TEXT = "DELETE MY ACCOUNT";
const bodySchema = z.object({ confirm: z.string() });

// Irreversible, so it needs the exact phrase, and it only ever deletes the signed-in user.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.confirm.trim() !== CONFIRM_TEXT) {
    return NextResponse.json({ error: "confirmation_required", expected: CONFIRM_TEXT }, { status: 400 });
  }
  const limit = await rateLimit(`delete:${user.id}`, 3, 3600);
  if (!limit.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const result = await deleteAccount(user.id);
  return NextResponse.json({ ok: true, ...result });
}
