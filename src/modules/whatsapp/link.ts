import { randomInt } from "node:crypto";
import { businessNumberDigits, normalizePhone, testNumbers } from "./state";
import type { Store } from "./store";

/**
 * Phase Y, Y2 (docs/whatsapp/TDD.md 4.1 item 3, 4.5, 4.9): the link code and the claim. The code is 8 characters from a
 * 32-letter alphabet (40 bits), valid 15 minutes, used once, and bound to the user who asked for it; the user sends it from
 * their own phone as "Join <code>", which is the opt-in.
 */

/** No 0/O or 1/I: 32 characters, so a code is read aloud and typed without doubt. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;
export const CODE_MINUTES = 15;

export function makeCode() {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** "Join K7Q4M9XA" (any case, spaces, a trailing full stop) to the code; null when the text is not a join message. */
export function parseJoin(text: string | undefined | null): string | null {
  const match = /^\s*join\s+([a-z0-9]{8})\s*[.!]?\s*$/i.exec(text ?? "");
  return match ? match[1].toUpperCase() : null;
}

/** The link the Account card opens: WhatsApp with the message already typed. Null until WHATSAPP_NUMBER_E164 is set. */
export function joinUrl(code: string) {
  const number = businessNumberDigits();
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(`Join ${code}`)}` : null;
}

/** The business number's chat with nothing typed (the card's "Open WhatsApp" once linked or stopped). */
export function chatUrl() {
  const number = businessNumberDigits();
  return number ? `https://wa.me/${number}` : null;
}

export type NewCode = { code: string; expiresAt: Date; url: string | null };

/** A fresh code for the user; their earlier unused codes stop working. */
export async function createLinkCode(userId: string, store: Store, now = new Date()): Promise<NewCode> {
  await store.deleteStaleCodes(userId, now);
  const expiresAt = new Date(now.getTime() + CODE_MINUTES * 60_000);
  for (let attempt = 0; ; attempt += 1) {
    const code = makeCode();
    try {
      await store.saveCode({ code, userId, expiresAt });
      return { code, expiresAt, url: joinUrl(code) };
    } catch (error) {
      // A code already taken (2^-40) is drawn again; any other failure is the caller's.
      if (attempt >= 3) throw error;
    }
  }
}

export type ClaimResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid_number" | "unknown_code" | "code_used" | "code_expired" | "number_in_use" | "test_number" | "no_user" };

/**
 * Binds `phone` to the user who made `code`. Refused when the code is unknown, used or expired, when the number is already
 * linked to a different user, and when the user is a test profile and the number is not in WHATSAPP_TEST_NUMBERS. The
 * code is spent in one database step, so two messages with the same code link at most once.
 */
export async function claimLink(phoneInput: string, codeInput: string, store: Store, now = new Date()): Promise<ClaimResult> {
  const phone = normalizePhone(phoneInput);
  if (!phone) return { ok: false, reason: "invalid_number" };
  const code = codeInput.trim().toUpperCase();
  const row = await store.findCode(code);
  if (!row) return { ok: false, reason: "unknown_code" };
  if (row.usedAt) return { ok: false, reason: "code_used" };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "code_expired" };

  const holder = await store.findLinkByPhone(phone);
  if (holder && holder.userId !== row.userId) return { ok: false, reason: "number_in_use" };
  const isTest = await store.userIsTest(row.userId);
  if (isTest === null) return { ok: false, reason: "no_user" };
  if (isTest && !testNumbers().includes(phone)) return { ok: false, reason: "test_number" };

  // The last check and the spend are one step: a second claim of this code finds it used.
  if (!(await store.consumeCode(code, now))) return { ok: false, reason: "code_used" };
  await store.upsertLink(row.userId, phone, now);
  return { ok: true, userId: row.userId };
}

/** Unlinking deletes the row at once: the number is gone with it. */
export async function unlink(userId: string, store: Store) {
  await store.deleteStaleCodes(userId, new Date());
  await store.deleteLink(userId);
}
