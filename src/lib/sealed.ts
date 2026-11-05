import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption at rest for a saved sign-in to a user's own job-site account (docs/naukri/TDD.md 4.9). The saved cookies
 * are a credential: AES-256-GCM under BROWSER_STATE_KEY (32 bytes, base64), bound to the storage key it is kept under,
 * so a blob copied to another user's key does not open. Layout: "SAS1" | 12-byte IV | 16-byte tag | ciphertext.
 */

const MAGIC = Buffer.from("SAS1");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SealKeyError extends Error {}

function readKey(): Buffer {
  const raw = process.env.BROWSER_STATE_KEY?.trim();
  if (!raw) throw new SealKeyError("BROWSER_STATE_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new SealKeyError("BROWSER_STATE_KEY must be 32 bytes, base64");
  return key;
}

/** Whether a sign-in can be saved and read on this process: the key is set and well formed. */
export function sealKeyReady() {
  try {
    readKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypts `plain` for the storage key `context`. Throws SealKeyError when the key is missing. */
export function seal(plain: Uint8Array, context: string): Uint8Array {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", readKey(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return new Uint8Array(Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]));
}

/**
 * The plain bytes, or null when the blob is not one of ours, was sealed under another key or for another storage key,
 * or was changed. Throws SealKeyError when this process has no key at all.
 */
export function unseal(sealed: Uint8Array, context: string): Uint8Array | null {
  const key = readKey();
  const bytes = Buffer.from(sealed);
  if (bytes.length < MAGIC.length + IV_BYTES + TAG_BYTES || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  const iv = bytes.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = bytes.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
  const body = bytes.subarray(MAGIC.length + IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]));
  } catch {
    return null;
  }
}
