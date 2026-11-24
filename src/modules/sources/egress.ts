import { createHmac } from "node:crypto";
import type { Site } from "./sites";

/**
 * Where a user's signed-in site traffic leaves from (Phase K, K7; docs/naukri/TDD.md 13.11 item 3, 13.12 "Egress"):
 * a residential proxy of their own, never the worker's own address (owner, 23 Nov).
 *
 * SIGNED_IN_PROXY_URL is the provider's gateway with `{session}` in it, the provider's sticky-session name, e.g.
 * `http://customer-acme-cc-in-sessid-{session}:secret@gate.example.com:7000`. Every request for one user carries the
 * same session name, so the provider keeps them on one address (24 hours to 7 days, by plan); another user's name gets
 * another address. The name is derived from the user's id with a key (SIGNED_IN_PROXY_SECRET, else BROWSER_STATE_KEY),
 * so nothing is stored and the provider never sees our ids. "off" runs direct from the worker: development only.
 * `{session:N}` gives a name of exactly N letters and digits for a provider that wants a fixed length (IPRoyal: 8, in
 * the password, e.g. `http://USER:PASS_country-in_city-bengaluru_session-{session:8}_lifetime-7d@geo.iproyal.com:12321`).
 * Unset, or a template without `{session}`, refuses the run: a signed-in site never falls back to our own address.
 */
export type Egress = {
  /** For Playwright's `proxy`: scheme, host and port. */
  server: string;
  username?: string;
  password?: string;
  /** For SeleniumBase's `proxy=`: "user:pass@host:port" (an http proxy) or "socks5://user:pass@host:port". */
  seleniumProxy: string;
  /** Safe to log: the host and the session name, never the password. */
  label: string;
};

export class EgressRefused extends Error {}

type Env = Record<string, string | undefined>;

/**
 * The user's sticky session name: the same for every run of this user and site, different between users. 16 hex
 * characters by default; `length` gives exactly that many letters and digits (base 36, so 8 still carry 41 bits).
 */
export function sessionName(userId: string, site: Site, env: Env = process.env, length?: number) {
  const secret = env.SIGNED_IN_PROXY_SECRET?.trim() || env.BROWSER_STATE_KEY?.trim();
  if (!secret) throw new EgressRefused("SIGNED_IN_PROXY_SECRET (or BROWSER_STATE_KEY) is not set, so a user's proxy session cannot be named.");
  const digest = createHmac("sha256", secret).update(`${site}:${userId}`).digest("hex");
  // Letters and digits only: every provider's session field takes that.
  if (length === undefined) return digest.slice(0, 16);
  return BigInt(`0x${digest}`).toString(36).padStart(length, "0").slice(0, length);
}

// `{session}` or `{session:N}` (N from 6 to 32) in the proxy template.
const SESSION_SLOT = /\{session(?::(\d{1,2}))?\}/g;

/**
 * The proxy this user's run on `site` goes through, or null when SIGNED_IN_PROXY_URL is "off" (direct, development).
 * Throws EgressRefused when no proxy is configured: the caller fails the run with nothing sent.
 */
export function egressFor(userId: string, site: Site, env: Env = process.env): Egress | null {
  const template = env.SIGNED_IN_PROXY_URL?.trim();
  if (template === "off") return null;
  if (!template) throw new EgressRefused("No proxy is set for signed-in sites (SIGNED_IN_PROXY_URL), and they never run from the worker's own address.");
  const slots = [...template.matchAll(SESSION_SLOT)];
  if (slots.length === 0) throw new EgressRefused("SIGNED_IN_PROXY_URL has no {session} in it, so every user would share one address.");
  const lengths = new Set(slots.map((slot) => (slot[1] ? Number(slot[1]) : undefined)));
  if ([...lengths].some((length) => length !== undefined && (length < 6 || length > 32))) throw new EgressRefused("SIGNED_IN_PROXY_URL's {session:N} needs N from 6 to 32.");
  const names = new Map([...lengths].map((length) => [length, sessionName(userId, site, env, length)]));
  const session = names.values().next().value as string;
  let url: URL;
  try {
    url = new URL(template.replace(SESSION_SLOT, (_slot, length?: string) => names.get(length ? Number(length) : undefined) as string));
  } catch {
    throw new EgressRefused("SIGNED_IN_PROXY_URL is not a valid address.");
  }
  if (!["http:", "https:", "socks5:"].includes(url.protocol) || !url.hostname || !url.port) {
    throw new EgressRefused("SIGNED_IN_PROXY_URL needs a scheme (http, https or socks5), a host and a port.");
  }
  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  const server = `${url.protocol}//${url.hostname}:${url.port}`;
  const auth = username ? `${username}${password ? `:${password}` : ""}@` : "";
  const seleniumProxy = url.protocol === "http:" ? `${auth}${url.hostname}:${url.port}` : `${url.protocol}//${auth}${url.hostname}:${url.port}`;
  return { server, username, password, seleniumProxy, label: `${url.hostname}:${url.port} session ${session}` };
}
