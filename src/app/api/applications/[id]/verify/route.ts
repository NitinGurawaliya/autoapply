import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { resolveVerification } from "@/modules/apply/lifecycle";

const bodySchema = z.object({ sent: z.boolean() });

/** The user says whether an application whose outcome was unknown (pending_verification) reached the employer. */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { id } = await context.params;
  const result = await resolveVerification(id, user.id, parsed.data.sent);
  if (result === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (result === "not_pending") return NextResponse.json({ error: "not_pending" }, { status: 409 });
  return NextResponse.json({ ok: true, status: result });
}
