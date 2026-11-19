import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { currentBrief } from "@/modules/profile";

// The candidate brief (P5): what the agent knows about the signed-in user when it judges fit, and the lines it has
// learned from their skips (P8). Rebuilt from the profile first; a write only when it changed. Never contact data.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await currentBrief(user.id);
  if (!result) return NextResponse.json({ error: "no_profile" }, { status: 404 });
  return NextResponse.json({ brief: result.brief, learned: result.learned, updatedAt: result.updatedAt.toISOString() });
}
