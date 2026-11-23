import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { sourcesOverview } from "@/modules/sources";

// The signed-in user's job-site connections (Account page; docs/naukri/TDD.md 6).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await sourcesOverview(user.id), { headers: { "Cache-Control": "no-store" } });
}
