import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { ingestResume } from "@/modules/profile";

export const runtime = "nodejs";

const MAX_BYTES = 5_000_000;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Each upload costs a model call, so a user gets a generous but finite number per hour.
  const limit = await rateLimit(`resume:${user.id}`, 10, 3600);
  if (!limit.ok) {
    return NextResponse.json({ error: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }

  const form = await req.formData();
  const file = form.get("resume");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "pdf_required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES || !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "pdf_required" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = new TextDecoder().decode(bytes.subarray(0, 5));
  if (!header.startsWith("%PDF")) {
    return NextResponse.json({ error: "pdf_required" }, { status: 400 });
  }

  const result = await ingestResume(user.id, bytes);
  return NextResponse.json({ ok: true, usedFallback: result.usedFallback });
}
