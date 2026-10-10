import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listFeed, parseFeedFilters } from "@/modules/jobs";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const filters = parseFeedFilters({
    boards: url.searchParams.get("boards") ?? undefined,
    country: url.searchParams.get("country") ?? undefined,
    expMax: url.searchParams.get("expMax") ?? undefined,
    days: url.searchParams.get("days") ?? undefined,
    level: url.searchParams.get("level") ?? undefined,
    stage: url.searchParams.get("stage") ?? undefined,
    track: url.searchParams.get("track") ?? undefined,
  });
  const jobs = await listFeed(user.id, filters);
  return NextResponse.json({ jobs });
}
