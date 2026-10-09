import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { cancelApplication } from "@/modules/apply/lifecycle";

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const result = await cancelApplication(id, user.id);
  if (result === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (result === "not_cancellable") return NextResponse.json({ error: "not_cancellable" }, { status: 409 });
  return NextResponse.json({ ok: true, status: "cancelled" });
}
