import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { siteListed } from "@/lib/site-flags";
import { isSite, streamTicket } from "@/modules/sources";

// K8: the phone's pass to the user's own streamed sign-in, the worker's address and a 10-minute token for that window
// only (modules/sources/connection.ts streamTicket). The frames themselves go from the worker to the phone directly,
// never through here. "waiting" while the worker opens the window; "ended" with the connection's status after it.
export async function GET(_req: Request, context: { params: Promise<{ site: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { site } = await context.params;
  if (!isSite(site) || !siteListed(site)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ticket = await streamTicket(user.id, site);
  return NextResponse.json(ticket, { headers: { "Cache-Control": "no-store" } });
}
