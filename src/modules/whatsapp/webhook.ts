import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normalizePhone, whatsappEnabled } from "./state";
import type { Store } from "./store";

/**
 * Phase Y, Y2 (docs/whatsapp/TDD.md 4.1 item 2, 4.5, 4.9, 6): what Meta sends to the webhook. Pure functions (signature,
 * challenge, parsing) and `processWebhook`, which stores what arrived and hands each new message to the queue; the route
 * only reads the raw body and calls it. Nothing here logs a phone number or a message text.
 */

export type InboundKind = "text" | "button" | "list" | "flow" | "document" | "other";

export type InboundMessage = {
  wamid: string;
  /** E.164 with the plus. */
  from: string;
  kind: InboundKind;
  /** The text typed, or the title of the option tapped. */
  text?: string;
  /** The id or payload of the option tapped (a template quick reply carries the job id here). */
  payload?: string;
  /** Unix seconds, as Meta sends it. */
  timestamp: number;
};

export type StatusEvent = { wamid: string; status: "sent" | "delivered" | "read" | "failed"; errorCode: string | null };

/** The HMAC-SHA256 of the raw body with the app secret, in `X-Hub-Signature-256` as "sha256=<hex>". */
export function sign(rawBody: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

export function verifySignature(rawBody: string, header: string | null | undefined, secret = process.env.WHATSAPP_APP_SECRET): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(sign(rawBody, secret));
  const given = Buffer.from(header.trim());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The GET check Meta makes once when the webhook is saved: the challenge to echo, or null. */
export function verifyChallenge(params: { mode: string | null; token: string | null; challenge: string | null }, expected = process.env.WHATSAPP_VERIFY_TOKEN): string | null {
  if (!expected || params.mode !== "subscribe" || !params.token || !params.challenge) return null;
  const a = Buffer.from(params.token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? params.challenge : null;
}

const messageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  timestamp: z.coerce.number().default(0),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  button: z.object({ payload: z.string().optional(), text: z.string().optional() }).optional(),
  interactive: z
    .object({
      type: z.string(),
      button_reply: z.object({ id: z.string(), title: z.string().optional() }).optional(),
      list_reply: z.object({ id: z.string(), title: z.string().optional() }).optional(),
      nfm_reply: z.object({ response_json: z.string().optional() }).optional(),
    })
    .optional(),
});

const statusSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  errors: z.array(z.object({ code: z.union([z.number(), z.string()]).optional() })).optional(),
});

const bodySchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z.array(
          z.object({
            field: z.string().optional(),
            value: z.object({ messages: z.array(z.unknown()).optional(), statuses: z.array(z.unknown()).optional() }),
          }),
        ),
      }),
    )
    .default([]),
});

function toInbound(raw: z.infer<typeof messageSchema>): InboundMessage | null {
  const from = normalizePhone(raw.from);
  if (!from) return null;
  const base = { wamid: raw.id, from, timestamp: raw.timestamp };
  if (raw.type === "text") return { ...base, kind: "text", text: raw.text?.body };
  // A tap on a template's quick-reply button.
  if (raw.type === "button") return { ...base, kind: "button", text: raw.button?.text, payload: raw.button?.payload };
  if (raw.type === "interactive" && raw.interactive) {
    const { type, button_reply, list_reply, nfm_reply } = raw.interactive;
    if (type === "button_reply" && button_reply) return { ...base, kind: "button", text: button_reply.title, payload: button_reply.id };
    if (type === "list_reply" && list_reply) return { ...base, kind: "list", text: list_reply.title, payload: list_reply.id };
    if (type === "nfm_reply") return { ...base, kind: "flow", payload: nfm_reply?.response_json };
  }
  if (raw.type === "document") return { ...base, kind: "document" };
  return { ...base, kind: "other" };
}

const STATUSES = new Set(["sent", "delivered", "read", "failed"]);

/** Every message and status in one webhook body; an entry that does not fit is skipped, never thrown on. */
export function parseEvents(body: unknown): { messages: InboundMessage[]; statuses: StatusEvent[] } {
  const messages: InboundMessage[] = [];
  const statuses: StatusEvent[] = [];
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { messages, statuses };
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      for (const item of change.value.messages ?? []) {
        const raw = messageSchema.safeParse(item);
        const message = raw.success ? toInbound(raw.data) : null;
        if (message) messages.push(message);
      }
      for (const item of change.value.statuses ?? []) {
        const raw = statusSchema.safeParse(item);
        if (!raw.success || !STATUSES.has(raw.data.status)) continue;
        const code = raw.data.errors?.[0]?.code;
        statuses.push({ wamid: raw.data.id, status: raw.data.status as StatusEvent["status"], errorCode: code === undefined ? null : String(code) });
      }
    }
  }
  return { messages, statuses };
}

/** What the queue job carries: the message the worker acts on (the row holds none of it). */
export type InboundJob = InboundMessage;

export type WebhookDeps = {
  store: Store;
  enqueue: (job: InboundJob) => Promise<unknown>;
  /** Called with a short code word when something is dropped; never with a number or text. */
  warn?: (what: string) => void;
};

/**
 * POST /api/whatsapp/webhook. Returns only 200 or 403 (TDD 6): Meta retries anything else for hours. The signature is
 * checked on the raw body before anything is parsed; a duplicate wamid is stored once and enqueued once.
 */
export async function processWebhook(rawBody: string, signatureHeader: string | null, deps: WebhookDeps): Promise<200 | 403> {
  // Switched off: answer and drop (nothing is stored, nothing is enqueued).
  if (!whatsappEnabled()) return 200;
  if (!verifySignature(rawBody, signatureHeader)) return 403;
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    deps.warn?.("body_not_json");
    return 200;
  }
  const { messages, statuses } = parseEvents(body);
  for (const message of messages) {
    try {
      const link = await deps.store.findLinkByPhone(message.from);
      const created = await deps.store.insertMessage({ wamid: message.wamid, userId: link?.userId ?? null, direction: "in", kind: message.kind });
      if (created) await deps.enqueue(message);
    } catch {
      deps.warn?.("message_not_handled");
    }
  }
  for (const status of statuses) {
    try {
      await deps.store.applyStatus(status.wamid, status.status, status.errorCode);
    } catch {
      deps.warn?.("status_not_stored");
    }
  }
  return 200;
}
