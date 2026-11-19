import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { forgetFeed } from "@/lib/feed-cache";
import { enqueuePrescan } from "@/lib/queue";
import { answerAsk } from "@/modules/profile";

const bodySchema = z.object({ family: z.string().min(1).max(64), yes: z.boolean() });

/**
 * The answer to the feed's question from skips (P8): "Stop showing {family} roles?", "Hide contract roles?". Either
 * answer closes it; a Yes that changed the fields or the "Never show me" chips rebuilds the feed as a profile edit does.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const result = await answerAsk(user.id, parsed.data.family, parsed.data.yes);
  if (!result.found) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (result.changed) {
    forgetFeed(user.id);
    after(() => enqueuePrescan(user.id, "profile").catch(() => undefined));
  }
  return NextResponse.json({ ok: true, changed: result.changed });
}
