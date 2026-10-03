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
  });
  const jobs = await listFeed(user.id, filters);
  return NextResponse.json({ jobs });
}
