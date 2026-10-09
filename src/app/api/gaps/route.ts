import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueuePrescan } from "@/lib/queue";
import { upsert, type AnswerContext } from "@/modules/answers";

// Answer one gap from the "Fill your gaps" page (T56). The answer is saved under the gap's key with the gap's own
// context (for a question about the job's country, that country), so memory can reuse it for every job it applies to.
const bodySchema = z.object({ key: z.string().min(1).max(80), answer: z.string().trim().min(1).max(2000) });

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const gap = await db.feedGap.findUnique({ where: { userId_key: { userId: user.id, key: parsed.data.key } } });
  if (!gap) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    await upsert(user.id, { key: gap.key, question: gap.label, answer: parsed.data.answer, source: "user", context: (gap.context as AnswerContext | null) ?? null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid" }, { status: 400 });
  }
  await db.feedGap.delete({ where: { userId_key: { userId: user.id, key: gap.key } } });
  void enqueuePrescan(user.id).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
