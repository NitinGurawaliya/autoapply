import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { dailySetOn, releaseMore } from "@/modules/jobs";

const bodySchema = z.object({ from: z.number().int().min(0) });

// "4 more" in the daily set (P7): releases the next batch only if `released` still equals `from` (compare-and-set). A
// rejected PATCH (a refresh or a second tab got there first) answers 409 with the current release, so no batch is skipped.
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!dailySetOn()) return NextResponse.json({ error: "daily_set_off" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { advanced, view } = await releaseMore(user.id, parsed.data.from);
  if (!view) return NextResponse.json({ error: "no_set" }, { status: 404 });
  return NextResponse.json({ advanced, set: view }, { status: advanced ? 200 : 409 });
}
