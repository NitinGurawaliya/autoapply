import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { dailyView, isDefaultFeed, listFeed, parseFeedFilters } from "@/modules/jobs";

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
  const skipped = url.searchParams.get("view") === "skipped";
  // The daily set (P7): the default view serves today's release; a filter, the skipped jobs or "Keep going" (`rest=1`)
  // get the ranked list. No set (switch off, too few jobs) also means the ranked list.
  if (!skipped && url.searchParams.get("rest") !== "1" && isDefaultFeed(filters)) {
    const set = await dailyView(user.id);
    if (set) return NextResponse.json({ jobs: set.jobs, set });
  }
  // `view=skipped`: the jobs the user swiped left, offered again once the feed runs out.
  const jobs = await listFeed(user.id, filters, skipped ? "skipped" : "new");
  return NextResponse.json({ jobs });
}
