import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { disconnect, isSite } from "@/modules/sources";

// Deletes the saved sign-in at once and cancels what was waiting to run on the site.
export async function POST(_req: Request, context: { params: Promise<{ site: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { site } = await context.params;
  if (!isSite(site)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const result = await disconnect(user.id, site);
  return NextResponse.json({ status: "disconnected", ...result });
}
