import { after, NextResponse } from "next/server";
import { enqueuePrescan } from "@/lib/queue";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { remove, getAll, upsert } from "@/modules/answers";

const putSchema = z.object({
  answers: z
    .array(
      z.object({
        key: z.string().min(1).max(80),
        // Shortened, not refused: see applications/[id]/answers/route.ts.
        question: z.string().max(5000).transform((text) => text.slice(0, 1000)),
        answer: z.string().max(2000),
        source: z.enum(["resume", "user", "ai_draft", "default"]),
      }),
    )
    .max(60),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const answers = await getAll(user.id);
  return NextResponse.json({
    answers: answers.map((row) => ({
      key: row.key,
      question: row.question,
      answer: row.answer,
      source: row.source,
    })),
  });
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = putSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  try {
    for (const row of parsed.data.answers) {
      await upsert(user.id, row);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  // New answers may close gaps in the feed (T56): rescan in the background (at most once per 10 minutes).
  after(() => enqueuePrescan(user.id).catch(() => undefined));

  const answers = await getAll(user.id);
  return NextResponse.json({
    answers: answers.map((row) => ({
      key: row.key,
      question: row.question,
      answer: row.answer,
      source: row.source,
    })),
  });
}

// Removing an answer makes the next application that needs it ask again.
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (key.length === 0 || key.length > 80) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const removed = await remove(user.id, key);
  return removed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not_found" }, { status: 404 });
}
