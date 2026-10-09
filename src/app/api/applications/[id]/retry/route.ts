import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { retryApplication } from "@/modules/apply/lifecycle";

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const result = await retryApplication(id, user.id);
  if (result.ok) return NextResponse.json({ ok: true, status: "queued" });
  if (result.reason === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (result.reason === "not_retryable") return NextResponse.json({ error: "not_retryable" }, { status: 409 });
  if (result.reason === "blocked") return NextResponse.json({ ok: false, blocked: result.rule }, { status: 403 });
  return NextResponse.json({ error: "queue_failed" }, { status: 500 });
}
