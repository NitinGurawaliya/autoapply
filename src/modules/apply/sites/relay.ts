import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import { streamSecret, verifyStreamToken, type Site } from "@/modules/sources";
import { inputEventSchema, viewportSchema, type ScreenStream } from "./screen-stream";

/**
 * The worker's own endpoint for streamed sign-ins (K8, owner 23 Nov: server-sent events down, POSTed input up; no
 * WebSocket, no library). The phone talks to the worker that holds its window, directly: frames never pass through
 * the web app or Postgres.
 *
 *   GET  /stream/<sid>?w=&h=   frames as server-sent events (`frame`, then `end` with the outcome)
 *   POST /stream/<sid>/input   { events: [...], viewport? }: taps, scrolls, text, keys
 *
 * Each needs `Authorization: Bearer <token>` (modules/sources/stream-token.ts) for that stream id and its user, and an
 * Origin of the app (APP_URL). A stream exists only while its connect job's window is open and ends with it. Nothing
 * from a request body, a frame or a token is ever logged: the log has the stream's opening and closing, with the last
 * six characters of the user id, as every connect log does.
 *
 * Env (worker): SOURCE_STREAM_PORT (listen), SOURCE_STREAM_PUBLIC_URL (the https address the phone reaches, e.g. the
 * host's domain or a tunnel), SOURCE_STREAM_SECRET (as the web app), APP_URL (the only Origin allowed).
 */

export type StreamOutcome = "connected" | "failed" | "cancelled" | "expired";

type Entry = {
  userId: string;
  site: Site;
  stream: ScreenStream;
  deadline: number;
  viewer: ServerResponse | null;
  unwatch: (() => void) | null;
};

const streams = new Map<string, Entry>();
let server: Server | null = null;
let publicBase: string | null = null;

const MAX_BODY_BYTES = 16 * 1024;
const HEARTBEAT_MS = 15_000;
const bodySchema = z.object({ events: z.array(inputEventSchema).max(64), viewport: viewportSchema.optional() });

type Env = Record<string, string | undefined>;

/** The relay's settings, or why there is none (a worker without them shows K1's window on its own screen). */
export function relayConfig(env: Env = process.env): { port: number; base: string; origin: string } | { error: string } {
  const port = Number(env.SOURCE_STREAM_PORT);
  const raw = env.SOURCE_STREAM_PUBLIC_URL?.trim();
  if (!Number.isInteger(port) || port <= 0 || port > 65535 || !raw) return { error: "SOURCE_STREAM_PORT and SOURCE_STREAM_PUBLIC_URL are not set" };
  if (!streamSecret(env)) return { error: "SOURCE_STREAM_SECRET is not set (32 characters or more)" };
  let base: URL;
  let origin: string;
  try {
    base = new URL(raw);
    origin = new URL(env.APP_URL?.trim() || "").origin;
  } catch {
    return { error: "SOURCE_STREAM_PUBLIC_URL or APP_URL is not a valid address" };
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  // A password crosses this stream: only https leaves the machine.
  if (base.protocol !== "https:" && !(local && base.protocol === "http:")) return { error: "SOURCE_STREAM_PUBLIC_URL must be https" };
  return { port, base: base.toString().replace(/\/$/, ""), origin };
}

/** Whether this worker serves streamed sign-ins now. */
export function relayReady() {
  return server !== null && publicBase !== null;
}

/** Starts the relay when it is configured; a worker without it keeps K1's window. Resolves to its public base or null. */
export async function startRelay(env: Env = process.env): Promise<string | null> {
  if (server) return publicBase;
  const config = relayConfig(env);
  if ("error" in config) return null;
  const listening = createServer((req, res) => {
    handle(req, res, config.origin).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    listening.once("error", reject);
    listening.listen(config.port, () => resolve());
  });
  server = listening;
  publicBase = config.base;
  console.log(`relay: streamed sign-ins served on :${config.port} as ${config.base}`);
  return publicBase;
}

export async function stopRelay() {
  for (const sid of [...streams.keys()]) endStream(sid, "cancelled");
  const closing = server;
  server = null;
  publicBase = null;
  if (closing) await new Promise<void>((resolve) => closing.close(() => resolve()));
}

/**
 * Registers a sign-in window's stream for one user until `deadline`. The returned `url` goes on the user's
 * SiteConnection (setStreamUrl); `end` tells the phone how it ended and closes everything.
 */
export function openStream(userId: string, site: Site, stream: ScreenStream, deadline: number) {
  if (!publicBase) throw new Error("The relay is not running");
  const sid = randomBytes(16).toString("base64url");
  streams.set(sid, { userId, site, stream, deadline, viewer: null, unwatch: null });
  console.log(`relay: stream opened for …${userId.slice(-6)}`);
  return { sid, url: `${publicBase}/stream/${sid}`, end: (outcome: StreamOutcome) => endStream(sid, outcome) };
}

function endStream(sid: string, outcome: StreamOutcome) {
  const entry = streams.get(sid);
  if (!entry) return;
  streams.delete(sid);
  entry.unwatch?.();
  if (entry.viewer && !entry.viewer.writableEnded) {
    entry.viewer.write(`event: end\ndata: ${JSON.stringify({ outcome })}\n\n`);
    entry.viewer.end();
  }
  console.log(`relay: stream closed for …${entry.userId.slice(-6)} (${outcome})`);
}

function cors(res: ServerResponse, origin: string) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
}

/** The stream this request may use, or null: a genuine token for this stream id, its user and site, not past the deadline. */
function authorize(req: IncomingMessage, sid: string): Entry | null {
  const entry = streams.get(sid);
  if (!entry) return null;
  if (Date.now() > entry.deadline) {
    endStream(sid, "expired");
    return null;
  }
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const claims = token ? verifyStreamToken(token) : null;
  if (!claims || claims.sid !== sid || claims.uid !== entry.userId || claims.site !== entry.site) return null;
  return entry;
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handle(req: IncomingMessage, res: ServerResponse, origin: string) {
  const url = new URL(req.url ?? "/", "http://relay");
  const match = /^\/stream\/([A-Za-z0-9_-]{16,64})(\/input)?$/.exec(url.pathname);
  if (!match) {
    res.writeHead(404).end();
    return;
  }
  // Only the app's own pages, in a browser, use the stream.
  if (req.headers.origin !== origin) {
    res.writeHead(403).end();
    return;
  }
  cors(res, origin);
  const [, sid, input] = match;
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", input ? "POST" : "GET");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
    res.writeHead(204).end();
    return;
  }
  const entry = authorize(req, sid);
  if (!entry) {
    // An ended stream and a wrong token look the same from outside.
    res.writeHead(404).end();
    return;
  }

  if (input) {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const raw = await readBody(req);
    let parsed: z.infer<typeof bodySchema> | null = null;
    try {
      const result = raw === null ? null : bodySchema.safeParse(JSON.parse(raw));
      parsed = result?.success ? result.data : null;
    } catch {
      parsed = null;
    }
    if (!parsed) {
      res.writeHead(400).end();
      return;
    }
    if (parsed.viewport) await entry.stream.resize(parsed.viewport).catch(() => undefined);
    const sent = parsed.events.length ? await entry.stream.input(parsed.events).catch(() => false) : true;
    res.writeHead(sent ? 204 : 409).end();
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }
  const viewport = viewportSchema.safeParse({ width: url.searchParams.get("w"), height: url.searchParams.get("h") });
  if (viewport.success) await entry.stream.resize(viewport.data).catch(() => undefined);
  // One viewer: a new one (a reload, a second tab) takes over and the old one is told.
  if (entry.viewer && !entry.viewer.writableEnded) {
    entry.unwatch?.();
    entry.viewer.write(`event: replaced\ndata: {}\n\n`);
    entry.viewer.end();
  }
  res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write(`event: open\ndata: ${JSON.stringify({ expiresAt: new Date(entry.deadline).toISOString() })}\n\n`);
  // Frames are dropped while the phone's connection is behind, never queued: the next one replaces them anyway.
  let blocked = false;
  res.on("drain", () => {
    blocked = false;
  });
  entry.viewer = res;
  entry.unwatch = entry.stream.watch((frame) => {
    if (blocked || res.writableEnded) return;
    blocked = !res.write(`event: frame\ndata: ${JSON.stringify({ d: frame.data, w: frame.width, h: frame.height })}\n\n`);
  });
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": beat\n\n");
  }, HEARTBEAT_MS);
  const deadline = setTimeout(() => endStream(sid, "expired"), Math.max(0, entry.deadline - Date.now()));
  res.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(deadline);
    if (entry.viewer === res) {
      entry.unwatch?.();
      entry.viewer = null;
      entry.unwatch = null;
    }
  });
}
