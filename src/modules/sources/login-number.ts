import { seal, unseal } from "@/lib/sealed";
import { storage } from "@/lib/storage";
import { siteStateKey, type Site } from "./sites";

/**
 * What a user connects a site with (K8b OTP connect, owner 23 Nov: kept so "Connect again" asks only for a new code): a
 * mobile number, and on Hirist an email too (K18). Sealed like the session (lib/sealed.ts, bound to its storage key),
 * beside it in storage, deleted with it on Disconnect and with the account. Read only by the worker that enters it on the
 * site's login; the app sees it masked.
 */

export function loginNumberKey(userId: string, site: Site) {
  return siteStateKey(userId, site).replace(/\.json$/, "-login.json");
}

const MOBILE = /^\d{10}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** What a user signs in with on the site's OTP page: Naukri a 10-digit mobile number, Hirist a mobile number or an email. */
export function isLoginId(site: Site, value: string) {
  if (MOBILE.test(value)) return true;
  return site === "hirist" && value.length <= 254 && EMAIL.test(value);
}

export async function saveLoginNumber(userId: string, site: Site, loginId: string) {
  if (!isLoginId(site, loginId)) return false;
  const key = loginNumberKey(userId, site);
  await storage.put(key, seal(new TextEncoder().encode(JSON.stringify({ loginId })), key), "application/octet-stream", userId);
  return true;
}

export async function loginNumber(userId: string, site: Site): Promise<string | null> {
  const key = loginNumberKey(userId, site);
  const stored = await storage.get(key).catch(() => null);
  const plain = stored ? unseal(stored.bytes, key) : null;
  if (!plain) return null;
  try {
    // Saved before K18 as { mobile }.
    const saved = JSON.parse(Buffer.from(plain).toString("utf8")) as { loginId?: unknown; mobile?: unknown };
    const value = saved.loginId ?? saved.mobile;
    return typeof value === "string" && isLoginId(site, value) ? value : null;
  } catch {
    return null;
  }
}

/** "+91 ••••• •4175" or "a•••@example.com": enough for the user to know which one, never the whole of it. */
export function maskNumber(loginId: string) {
  if (loginId.includes("@")) {
    const [name, domain] = loginId.split("@");
    return `${name.slice(0, 1)}•••@${domain}`;
  }
  return `+91 ••••• •${loginId.slice(-4)}`;
}

export async function deleteLoginNumber(userId: string, site: Site) {
  await storage.delete(loginNumberKey(userId, site));
}
