import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pushPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";

// A browser's push subscription (lib/push.ts). The endpoint is the push service's URL for this browser.
const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000).refine((url) => url.startsWith("https://"), "https only"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** The server's public key, which the browser needs to subscribe. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ publicKey: pushPublicKey() });
}

/** Save this browser's subscription for the signed-in user (an endpoint moves to the user who saves it last). */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = subscriptionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { endpoint, keys } = parsed.data;
  // A user turning notifications on in more than 10 browsers keeps the newest 10.
  const count = await db.pushSubscription.count({ where: { userId: user.id } });
  if (count >= 10) {
    const oldest = await db.pushSubscription.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (oldest) await db.pushSubscription.delete({ where: { id: oldest.id } });
  }
  await db.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    update: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth },
  });
  return NextResponse.json({ ok: true });
}

/** Forget this browser's subscription (notifications turned off). */
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });
  await db.pushSubscription.deleteMany({ where: { userId: user.id, endpoint: body.endpoint } });
  return NextResponse.json({ ok: true });
}
