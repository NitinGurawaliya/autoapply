import { createHmac } from "node:crypto";
import { z } from "zod";

/**
 * Phase Y (docs/whatsapp/TDD.md 4.3, 4.4, 4.13): the switch, the phone number helpers and the Zod shapes of the two Json
 * columns on WhatsAppLink. A phone number is personal data: it is kept only in WhatsAppLink.phone, never logged, never in
 * an event, and shown masked.
 */

/** The whole feature is off unless WHATSAPP_ENABLED=1 (the same on the web app and every worker). */
export function whatsappEnabled() {
  return process.env.WHATSAPP_ENABLED === "1";
}

/** "+91 98765 43210", "91-98765-43210" or Meta's "919876543210" to E.164 "+919876543210"; null when it is not a plausible number. */
export function normalizePhone(input: string | null | undefined): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/** The numbers a test profile may link (WHATSAPP_TEST_NUMBERS, comma separated), normalised. */
export function testNumbers(): string[] {
  return (process.env.WHATSAPP_TEST_NUMBERS ?? "")
    .split(",")
    .map((entry) => normalizePhone(entry))
    .filter((entry): entry is string => entry !== null);
}

/** "+91 ••••• ••482" as the Account card draws it (design/whatsapp.html): the country code only for India, the last three digits. */
export function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const tail = digits.slice(-3);
  const code = digits.startsWith("91") && digits.length === 12 ? "+91" : "+••";
  return `${code} ••••• ••${tail}`;
}

/**
 * A stable key for a number that is not the number: the queue group and the rate-limit keys use it, so no table other than
 * WhatsAppLink holds a phone. HMAC with the app secret, 16 hex characters.
 */
export function phoneKey(phone: string) {
  return createHmac("sha256", process.env.WHATSAPP_APP_SECRET ?? "swipeapply").update(phone).digest("hex").slice(0, 16);
}

/** Digits of WHATSAPP_NUMBER_E164, for the wa.me link; null when it is not set. */
export function businessNumberDigits() {
  const digits = (process.env.WHATSAPP_NUMBER_E164 ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

/** The app's address for links in a chat message. */
export function appBase() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

const isoString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "not a date");

/** WhatsAppLink.state (§4.4). Y2 only ever stores `idle`; the deck, ask and confirm_stop modes arrive in Y3 to Y5. */
export const conversationStateSchema = z.object({
  mode: z.enum(["idle", "deck", "ask", "confirm_stop"]),
  deck: z.object({ jobIds: z.array(z.string()), at: z.number().int().min(0), shownAt: isoString }).optional(),
  ask: z.object({ applicationId: z.string(), kind: z.enum(["answers", "code"]), index: z.number().int().min(0), keys: z.array(z.string()) }).optional(),
  updatedAt: isoString,
});
export type ConversationState = z.infer<typeof conversationStateSchema>;

/** WhatsAppLink.plan (§4.3): the day's times, drawn once a day (Y3, Y5). */
export const dayPlanSchema = z.object({
  day: z.string(),
  morning: isoString,
  drops: z.array(isoString),
  sentMorning: z.boolean(),
  sentDrops: z.number().int().min(0),
});
export type DayPlan = z.infer<typeof dayPlanSchema>;

/** A stored value read back: the parsed shape, or null when the column is empty or does not fit (the conversation then starts idle). */
export function readState(value: unknown): ConversationState | null {
  const parsed = conversationStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function readPlan(value: unknown): DayPlan | null {
  const parsed = dayPlanSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
