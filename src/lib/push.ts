import webpush from "web-push";
import { db } from "@/lib/db";

/**
 * Browser push (Web Push, VAPID): reaches a user whose app is closed, on every browser where they turned notifications
 * on (PushSubscription rows, saved by /api/push). Used for new matching jobs after each ingest (modules/jobs/warm.ts)
 * and for runs waiting on the user (lib/notify.ts). The service worker that shows them is public/sw.js. A subscription
 * the push service reports gone (404 / 410) is deleted. Off when the VAPID keys are not set (ARCHITECTURE §11).
 */

export type PushMessage = { title: string; body: string; url: string; tag: string };

let configured: boolean | null = null;

function configure() {
  if (configured !== null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  configured = !!publicKey && !!privateKey;
  if (configured) webpush.setVapidDetails(process.env.VAPID_SUBJECT?.trim() || "mailto:admin@swipeapply.local", publicKey!, privateKey!);
  return configured;
}

export function pushPublicKey() {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

/** Sends to every browser of the user; returns how many took it. Never throws. */
export async function sendPush(userId: string, message: PushMessage) {
  if (!configure()) return 0;
  const subscriptions = await db.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(message),
        { TTL: 6 * 60 * 60, topic: message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined },
      );
      sent += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => undefined);
      else console.error(`push …${userId.slice(-6)}: ${status ?? (error instanceof Error ? error.message.slice(0, 60) : "failed")}`);
    }
  }
  return sent;
}

export function appUrl(path: string) {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;
}
