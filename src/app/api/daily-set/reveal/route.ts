import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { dailySetOn, markRevealed } from "@/modules/jobs";

// The day's reveal was seen (Phase R, docs/reveal/TDD.md 4.3): it does not play again today, on any device. Called when
// the reveal ends or is skipped; a failed call only means it plays once more on the next load.
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!dailySetOn()) return NextResponse.json({ error: "daily_set_off" }, { status: 404 });
  if (!(await markRevealed(user.id))) return NextResponse.json({ error: "no_set" }, { status: 404 });
  return NextResponse.json({ revealed: true });
}
