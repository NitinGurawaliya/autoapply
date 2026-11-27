import { enqueueWhatsAppInbound } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "./client";
import { handleInbound as handleInboundWith } from "./inbound";
import { chatUrl, createLinkCode as createLinkCodeWith, unlink as unlinkWith } from "./link";
import { maskPhone, phoneKey } from "./state";
import { prismaStore } from "./store";
import { processWebhook, type InboundMessage } from "./webhook";

/**
 * Phase Y (docs/whatsapp/TDD.md 4.12): the module's public face, bound to Postgres. Web routes call `receiveWebhook`,
 * `createLinkCode`, `unlink` and `linkStatus`; the worker calls `handleInbound` and `pruneStrangerMessages`. The web
 * never calls the Graph API (the worker's client does). Never import `@/modules/apply` from here.
 */
export { whatsappEnabled, maskPhone } from "./state";
export { verifyChallenge, verifySignature, parseEvents } from "./webhook";
export type { InboundMessage } from "./webhook";
export { classifyError, WhatsAppSendError } from "./client";

export const whatsappClient = createClient({ store: prismaStore });

/** POST /api/whatsapp/webhook: stores what arrived, enqueues each new message; 200 or 403. */
export function receiveWebhook(rawBody: string, signature: string | null) {
  return processWebhook(rawBody, signature, {
    store: prismaStore,
    enqueue: (message) => enqueueWhatsAppInbound({ ...message }, phoneKey(message.from)),
    warn: (what) => console.warn(`whatsapp webhook: ${what}`),
  });
}

/** The worker's step for one inbound message. */
export function handleInbound(message: InboundMessage) {
  return handleInboundWith(message, {
    store: prismaStore,
    client: whatsappClient,
    allow: async (key, max, windowSeconds) => (await rateLimit(key, max, windowSeconds)).ok,
    warn: (what) => console.warn(`whatsapp inbound: ${what}`),
  });
}

export const pruneStrangerMessages = () => prismaStore.pruneStrangerMessages(new Date());

/** POST /api/whatsapp/link. */
export const createLinkCode = (userId: string) => createLinkCodeWith(userId, prismaStore);

/** DELETE /api/whatsapp/link: the row, and with it the number, is gone at once. */
export const unlink = (userId: string) => unlinkWith(userId, prismaStore);

export type LinkStatus = {
  linked: boolean;
  phoneMasked: string | null;
  morningAt: string | null;
  dropsPerDay: number | null;
  timezone: string | null;
  pausedUntil: string | null;
  optedOut: boolean;
  /** The business number's chat, for "Open WhatsApp" once linked or stopped; null until WHATSAPP_NUMBER_E164 is set. */
  chatUrl: string | null;
};

/** GET /api/whatsapp/link and the Account page: what the card shows. The number leaves here masked. */
export async function linkStatus(userId: string): Promise<LinkStatus> {
  const link = await prismaStore.findLinkByUser(userId);
  if (!link) return { linked: false, phoneMasked: null, morningAt: null, dropsPerDay: null, timezone: null, pausedUntil: null, optedOut: false, chatUrl: chatUrl() };
  const paused = link.pausedUntil && link.pausedUntil.getTime() > Date.now() ? link.pausedUntil.toISOString() : null;
  return {
    linked: true,
    phoneMasked: maskPhone(link.phone),
    morningAt: link.morningAt,
    dropsPerDay: link.dropsPerDay,
    timezone: link.timezone,
    pausedUntil: paused,
    optedOut: link.optedOutAt !== null,
    chatUrl: chatUrl(),
  };
}
