import { isAdmin } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { enqueueIngest } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";

const MAX_DAYS = 60;

// Ingest fetches every company's board, so it is an operator action: named in ADMIN_EMAILS, bounded, rate limited.
// The worker also runs it on a schedule, so normal users never need this.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(user.email)) return Response.json({ error: "forbidden" }, { status: 403 });

  let days = 7;
  try {
    const body = (await request.json()) as { days?: unknown };
    if (body.days !== undefined) days = Number(body.days);
  } catch {
    days = 7;
  }
  if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS) {
    return Response.json({ error: `days must be between 1 and ${MAX_DAYS}` }, { status: 400 });
  }

  const limit = await rateLimit(`ingest:${user.id}`, 3, 3600);
  if (!limit.ok) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });

  const id = await enqueueIngest(Math.floor(days));
  return Response.json({ id, days: Math.floor(days) });
}
