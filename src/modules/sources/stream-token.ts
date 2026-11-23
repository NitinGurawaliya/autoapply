import { createHmac, timingSafeEqual } from "node:crypto";
import type { Site } from "./sites";

/**
 * The phone's pass to one streamed sign-in (K8, docs/naukri/TDD.md 13.12 "Connect on a phone"). The worker holding the
 * sign-in window serves it at its own address (`SiteConnection.streamUrl`, ending in a random stream id); the web app,
 * which knows who is signed in, signs a short-lived token for that stream id and user; the worker accepts only a token
 * for the window it holds. The address alone opens nothing, so the database never holds a working pass.
 *
 * SOURCE_STREAM_SECRET (web and worker, at least 32 characters) signs it. Unset: no stream is offered, and a worker
 * falls back to K1's window on its own screen.
 */

type Env = Record<string, string | undefined>;

export type StreamClaims = {
  /** The stream id the worker made for this window (random, 128 bits). */
  sid: string;
  /** The user the window signs in. */
  uid: string;
  site: Site;
  /** Expiry, epoch ms. */
  exp: number;
};

/** A token lives at most this long; the phone asks for a new one when it reconnects. */
export const STREAM_TOKEN_TTL_MS = 10 * 60 * 1000;

export function streamSecret(env: Env = process.env) {
  const secret = env.SOURCE_STREAM_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

function mac(body: string, secret: string) {
  return createHmac("sha256", secret).update(`stream:${body}`).digest("base64url");
}

export function signStreamToken(claims: StreamClaims, env: Env = process.env) {
  const secret = streamSecret(env);
  if (!secret) throw new Error("SOURCE_STREAM_SECRET is not set (32 characters or more)");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

/** The claims of a genuine, unexpired token; null for anything else. */
export function verifyStreamToken(token: string, now = Date.now(), env: Env = process.env): StreamClaims | null {
  const secret = streamSecret(env);
  if (!secret || token.length > 1024) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<StreamClaims>;
    if (typeof claims.sid !== "string" || typeof claims.uid !== "string" || typeof claims.site !== "string" || typeof claims.exp !== "number") return null;
    if (claims.exp <= now) return null;
    return claims as StreamClaims;
  } catch {
    return null;
  }
}

/** The stream id at the end of a worker's stream address (`<base>/stream/<sid>`), or null. */
export function streamIdOf(streamUrl: string) {
  const match = /\/stream\/([A-Za-z0-9_-]{16,64})$/.exec(streamUrl);
  return match ? match[1] : null;
}
