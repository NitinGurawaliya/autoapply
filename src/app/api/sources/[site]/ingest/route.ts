import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enqueueSourceIngest } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { sourceRules } from "@/modules/governance";
import { siteListed, userReadOff } from "@/lib/site-flags";
import { isSite, runsToday, screenWorkerAlive, usableConnection } from "@/modules/sources";

// "Fetch my Naukri jobs now" (docs/naukri/TDD.md 6): one run soon, within the same per-day budget as the schedule.
export async function POST(_req: Request, context: { params: Promise<{ site: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { site } = await context.params;
  if (!isSite(site) || !siteListed(site)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Our own reader finds the jobs (K14); a user's account reads nothing on request.
  if (userReadOff(site)) return NextResponse.json({ error: "shared_reader" }, { status: 409 });
  if (!(await usableConnection(user.id, site))) return NextResponse.json({ error: "not_connected" }, { status: 409 });
  if (!(await screenWorkerAlive())) return NextResponse.json({ error: "no_screen_worker" }, { status: 409 });
  const rules = sourceRules(site);
  if (!rules || (await runsToday(user.id, site)) >= rules.runs_per_day) return NextResponse.json({ error: "daily_limit" }, { status: 429 });
  const limit = await rateLimit(`source-ingest:${user.id}`, 1, 3 * 3600);
  if (!limit.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const queued = await enqueueSourceIngest(user.id, site).catch(() => null);
  return NextResponse.json({ status: queued ? "queued" : "already_queued" }, { status: 202 });
}
