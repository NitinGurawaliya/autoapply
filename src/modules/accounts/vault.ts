import { createCipheriv, createDecipheriv, randomBytes, randomInt } from "node:crypto";

/**
 * Phase U, U1 (docs/accounts/TDD.md 4.8): the only place employer-account passwords are encrypted or read back.
 * AES-256-GCM with ACCOUNTS_KEY (32 random bytes, base64), in the web app's and the worker's env only. Stored as
 * `v1:<iv>:<tag>:<ciphertext>` (base64 parts). A decrypted value lives in memory for one use and is never logged.
 */
const VERSION = "v1";

function key(): Buffer {
  const raw = process.env.ACCOUNTS_KEY?.trim();
  if (!raw) throw new Error("ACCOUNTS_KEY is not set: employer accounts are off");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) throw new Error("ACCOUNTS_KEY must be 32 bytes, base64");
  return bytes;
}

export function vaultReady() {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

export function decrypt(sealed: string): string {
  const [version, iv, tag, body] = sealed.split(":");
  if (version !== VERSION || !iv || !tag || !body) throw new Error("not a sealed value");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGIT = "23456789";
// Symbols every account system seen so far accepts (Workday's "special character"); no quotes, spaces or backslashes.
const SYMBOL = "!@#$%*-_+=?";

/**
 * The password the agent makes for a user's employer accounts (owner, 23 Nov: one per user, made by us and shown in
 * Account). 16 characters with at least two upper-case letters, lower-case letters, digits and symbols each, so it
 * passes Workday's rules (an upper, a lower, a digit, a symbol, 8 or more) and the other systems' (docs/accounts/TDD.md 3.1).
 */
export function generatePassword(length = 16): string {
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(UPPER), pick(UPPER), pick(LOWER), pick(LOWER), pick(DIGIT), pick(DIGIT), pick(SYMBOL), pick(SYMBOL)];
  const all = UPPER + LOWER + DIGIT + SYMBOL;
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Whether a password meets the rule every account system takes: 12+, an upper, a lower, a digit and a symbol. */
export function passwordFitsRule(password: string) {
  return password.length >= 12 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}
