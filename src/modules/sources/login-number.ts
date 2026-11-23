import { seal, unseal } from "@/lib/sealed";
import { storage } from "@/lib/storage";
import { siteStateKey, type Site } from "./sites";

/**
 * The mobile number a user connects a site with (K8b OTP connect, owner 23 Nov: kept so "Connect again" asks only for
 * a new code). Sealed like the session (lib/sealed.ts, bound to its storage key), beside it in storage, deleted with it
 * on Disconnect and with the account. Read only by the worker that enters it on the site's login; the app sees it masked.
 */

export function loginNumberKey(userId: string, site: Site) {
  return siteStateKey(userId, site).replace(/\.json$/, "-login.json");
}

export async function saveLoginNumber(userId: string, site: Site, mobile: string) {
  if (!/^\d{10}$/.test(mobile)) return false;
  const key = loginNumberKey(userId, site);
  await storage.put(key, seal(new TextEncoder().encode(JSON.stringify({ mobile })), key), "application/octet-stream", userId);
  return true;
}

export async function loginNumber(userId: string, site: Site): Promise<string | null> {
  const key = loginNumberKey(userId, site);
  const stored = await storage.get(key).catch(() => null);
  const plain = stored ? unseal(stored.bytes, key) : null;
  if (!plain) return null;
  try {
    const { mobile } = JSON.parse(Buffer.from(plain).toString("utf8")) as { mobile?: unknown };
    return typeof mobile === "string" && /^\d{10}$/.test(mobile) ? mobile : null;
  } catch {
    return null;
  }
}

/** "+91 ••••• •4175": enough for the user to know which number, never the whole of it. */
export function maskNumber(mobile: string) {
  return `+91 ••••• •${mobile.slice(-4)}`;
}

export async function deleteLoginNumber(userId: string, site: Site) {
  await storage.delete(loginNumberKey(userId, site));
}
