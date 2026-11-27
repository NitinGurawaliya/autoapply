import { normalizePhone } from "./state";
import type { Store } from "./store";

/**
 * Phase Y, Y2 (docs/whatsapp/TDD.md 4.1 item 1, 4.9): the Graph API, called only from the worker. The access token is read
 * here and nowhere else. Every send writes a WhatsAppMessage row (kind, never the text) and returns Meta's message id.
 * Errors are typed; nothing in a thrown error or a log line carries a phone number or a message text.
 */

export type SendErrorKind = "window_closed" | "rate_limited" | "number_unreachable" | "not_configured" | "other";

export class WhatsAppSendError extends Error {
  constructor(
    readonly kind: SendErrorKind,
    /** Meta's error code, or the HTTP status; the only detail kept. */
    readonly code: string | null,
  ) {
    super(`whatsapp send failed: ${kind}${code ? ` (${code})` : ""}`);
    this.name = "WhatsAppSendError";
  }
}

/** Meta's error code to our kind. 131047: more than 24 hours since the user's last message. */
export function classifyError(httpStatus: number, code: number | string | null | undefined): SendErrorKind {
  const value = code === null || code === undefined ? "" : String(code);
  if (value === "131047" || value === "131051") return "window_closed";
  if (httpStatus === 429 || ["130429", "131056", "80007", "4", "17", "32", "613"].includes(value)) return "rate_limited";
  if (["131026", "131030", "133010"].includes(value)) return "number_unreachable";
  return "other";
}

export type SendTarget = { to: string; userId: string | null; applicationId?: string | null };
export type ReplyButton = { id: string; title: string };
export type ListRow = { id: string; title: string; description?: string };

/** WhatsApp's limits: 3 reply buttons of 20 characters; 10 rows with 24-character titles and 72-character descriptions. */
const clip = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`);

type ClientOptions = { store: Store; fetchImpl?: typeof fetch; now?: () => Date };

export function createClient({ store, fetchImpl = fetch, now = () => new Date() }: ClientOptions) {
  async function post(payload: Record<string, unknown>): Promise<string> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) throw new WhatsAppSendError("not_configured", null);
    const version = process.env.WHATSAPP_GRAPH_VERSION || "v25.0";
    let response: Response;
    try {
      response = await fetchImpl(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new WhatsAppSendError("other", "network");
    }
    const body = (await response.json().catch(() => null)) as { messages?: Array<{ id?: string }>; error?: { code?: number | string } } | null;
    if (!response.ok) throw new WhatsAppSendError(classifyError(response.status, body?.error?.code), String(body?.error?.code ?? response.status));
    const wamid = body?.messages?.[0]?.id;
    if (!wamid) throw new WhatsAppSendError("other", "no_id");
    return wamid;
  }

  /** Sends `payload` to the target and records the row; returns the wamid. */
  async function send(target: SendTarget, kind: string, payload: Record<string, unknown>) {
    const phone = normalizePhone(target.to);
    if (!phone) throw new WhatsAppSendError("number_unreachable", "invalid_number");
    const wamid = await post({ recipient_type: "individual", to: phone.slice(1), ...payload });
    await store.insertMessage({ wamid, userId: target.userId, direction: "out", kind, applicationId: target.applicationId ?? null });
    if (target.userId) await store.touchOutbound(target.userId, now());
    return wamid;
  }

  return {
    sendText: (target: SendTarget, text: string) => send(target, "text", { type: "text", text: { body: text, preview_url: false } }),

    /** Up to 3 reply buttons. */
    sendButtons: (target: SendTarget, text: string, buttons: ReplyButton[]) => {
      if (buttons.length < 1 || buttons.length > 3) throw new Error("sendButtons takes 1 to 3 buttons");
      return send(target, "button", {
        type: "interactive",
        interactive: { type: "button", body: { text }, action: { buttons: buttons.map((button) => ({ type: "reply", reply: { id: button.id, title: clip(button.title, 20) } })) } },
      });
    },

    /** Up to 10 rows; `label` is the button that opens the list. */
    sendList: (target: SendTarget, text: string, label: string, rows: ListRow[]) => {
      if (rows.length < 1 || rows.length > 10) throw new Error("sendList takes 1 to 10 rows");
      return send(target, "list", {
        type: "interactive",
        interactive: {
          type: "list",
          body: { text },
          action: { button: clip(label, 20), sections: [{ title: "Options", rows: rows.map((row) => ({ id: row.id, title: clip(row.title, 24), ...(row.description ? { description: clip(row.description, 72) } : {}) })) }] },
        },
      });
    },

    /** A template by name with body variables, and a payload for each quick-reply button (the job id, Y5). */
    sendTemplate: (target: SendTarget, name: string, params: string[], buttonPayloads: string[] = [], language = "en") =>
      send(target, `template:${name}`, {
        type: "template",
        template: {
          name,
          language: { code: language },
          components: [
            ...(params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : []),
            ...buttonPayloads.map((payload, index) => ({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }] })),
          ],
        },
      }),

    /** Marks the user's message read and shows the typing indicator for up to 25 seconds. Best effort: never throws. */
    async markRead(wamid: string, options: { typing?: boolean } = {}) {
      try {
        await post({ status: "read", message_id: wamid, ...(options.typing ? { typing_indicator: { type: "text" } } : {}) });
      } catch {
        // A read receipt is a courtesy.
      }
    },
  };
}

export type WhatsAppClient = ReturnType<typeof createClient>;
