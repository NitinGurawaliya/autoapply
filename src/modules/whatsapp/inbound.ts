import { WhatsAppSendError, type WhatsAppClient } from "./client";
import { copy } from "./copy";
import { claimLink, parseJoin } from "./link";
import { phoneKey } from "./state";
import type { Store } from "./store";
import type { InboundMessage } from "./webhook";

/**
 * Phase Y, Y2 (docs/whatsapp/TDD.md 4.5): what the worker does with one inbound message. A "Join <code>" binds the number to
 * the user; a message from a number nobody linked gets one line a day and nothing more (no conversation with strangers, no
 * job cards). A linked user's message only opens the service window here; the conversation (deck, ask) arrives in Y3 to Y5.
 * Dependencies are passed in, so the flow is tested offline. Nothing here logs a number or a text.
 */

export type InboundOutcome = "linked" | "refused" | "stranger_replied" | "stranger_silent" | "linked_user";

export type InboundDeps = {
  store: Store;
  client: Pick<WhatsAppClient, "sendText">;
  /** True when this key may act `max` times per `windowSeconds`; the real one counts in RateEvent (lib/rate-limit.ts). */
  allow: (key: string, max: number, windowSeconds: number) => Promise<boolean>;
  now?: () => Date;
  warn?: (what: string) => void;
};

const DAY = 24 * 3600;

export async function handleInbound(message: InboundMessage, deps: InboundDeps): Promise<InboundOutcome> {
  const { store, client } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const key = phoneKey(message.from);

  /** A reply that fails to send is logged by kind and dropped: a retry of the job would only claim a spent code again. */
  async function reply(text: string) {
    try {
      await client.sendText({ to: message.from, userId: null }, text);
    } catch (error) {
      deps.warn?.(error instanceof WhatsAppSendError ? `reply_not_sent:${error.kind}` : "reply_not_sent");
    }
  }

  const code = message.kind === "text" ? parseJoin(message.text) : null;
  if (code) {
    const result = await claimLink(message.from, code, store, now);
    if (result.ok) {
      const link = await store.findLinkByUser(result.userId);
      try {
        await client.sendText({ to: message.from, userId: result.userId }, copy.linked(link?.morningAt ?? "08:30"));
      } catch (error) {
        deps.warn?.(error instanceof WhatsAppSendError ? `welcome_not_sent:${error.kind}` : "welcome_not_sent");
      }
      return "linked";
    }
    // A refusal says the same thing for every reason (a wrong code and another user's number look alike from outside), at
    // most 5 a day to one number.
    if (await deps.allow(`wa-refused:${key}`, 5, DAY)) await reply(copy.codeRefused());
    return "refused";
  }

  const link = await store.findLinkByPhone(message.from);
  if (link) {
    await store.touchInbound(link.userId, now);
    return "linked_user";
  }
  if (await deps.allow(`wa-stranger:${key}`, 1, DAY)) {
    await reply(copy.stranger());
    return "stranger_replied";
  }
  return "stranger_silent";
}
