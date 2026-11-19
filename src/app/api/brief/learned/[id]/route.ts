import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { forgetFeed } from "@/lib/feed-cache";
import { deleteLearned } from "@/modules/profile";

/** Deletes a learned line (× on /account, P8): its dismissal date is kept, so later skips count from now; the rank returns. */
export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (!(await deleteLearned(user.id, id))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  forgetFeed(user.id);
  return NextResponse.json({ ok: true });
}
