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

/** The user's sticky session name: the same for every run of this user and site, different between users. */
export function sessionName(userId: string, site: Site, env: Env = process.env) {
  const secret = env.SIGNED_IN_PROXY_SECRET?.trim() || env.BROWSER_STATE_KEY?.trim();
  if (!secret) throw new EgressRefused("SIGNED_IN_PROXY_SECRET (or BROWSER_STATE_KEY) is not set, so a user's proxy session cannot be named.");
  // Letters and digits only, 16 of them: every provider's session field takes that.
  return createHmac("sha256", secret).update(`${site}:${userId}`).digest("hex").slice(0, 16);
}

/**
 * The proxy this user's run on `site` goes through, or null when SIGNED_IN_PROXY_URL is "off" (direct, development).
 * Throws EgressRefused when no proxy is configured: the caller fails the run with nothing sent.
 */
export function egressFor(userId: string, site: Site, env: Env = process.env): Egress | null {
  const template = env.SIGNED_IN_PROXY_URL?.trim();
  if (template === "off") return null;
  if (!template) throw new EgressRefused("No proxy is set for signed-in sites (SIGNED_IN_PROXY_URL), and they never run from the worker's own address.");
  if (!template.includes("{session}")) throw new EgressRefused("SIGNED_IN_PROXY_URL has no {session} in it, so every user would share one address.");
  const session = sessionName(userId, site, env);
  let url: URL;
  try {
    url = new URL(template.replaceAll("{session}", session));
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
