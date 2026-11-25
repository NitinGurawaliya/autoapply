import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import { streamSecret, verifyStreamToken, type Site } from "@/modules/sources";
import type { OtpStep } from "./naukriOtp";
import { inputEventSchema, viewportSchema, type ScreenStream } from "./screen-stream";

/**
 * The worker's own endpoint for streamed sign-ins (K8, owner 23 Nov: server-sent events down, POSTed input up; no
 * WebSocket, no library). The phone talks to the worker that holds its window, directly: frames never pass through
 * the web app or Postgres.
 *
 *   GET  /stream/<sid>?w=&h=&frames=   server-sent events: `open` (the saved number, masked), `frame` (unless
 *                                      frames=0), then `end` with the outcome
 *   POST /stream/<sid>/input           { events: [...], viewport?, frames? }: taps, scrolls, text, keys; frames on/off
 *   POST /stream/<sid>/login           { mobile } or { saved: true }: OTP connect (K8b), Naukri texts a code
 *   POST /stream/<sid>/code            { code }: Naukri's code, entered on its page and forgotten
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

/** OTP connect (K8b): what the worker does with the number and the code. Neither is kept here. */
export type OtpHandlers = {
  /** The number to text a code to, or null for the saved one. */
  send: (mobile: string | null) => Promise<OtpStep>;
  enter: (code: string) => Promise<OtpStep>;
  /** The saved number, masked ("+91 ••••• •4175"), or null. */
  savedNumber: string | null;
};

type Entry = {
  userId: string;
  site: Site;
  stream: ScreenStream;
  deadline: number;
  viewer: ServerResponse | null;
  unwatch: (() => void) | null;
  otp: OtpHandlers | null;
  /** Whether frames go to the phone: off while it shows its own number and code screens, on for the page. */
  frames: boolean;
  /** One OTP step at a time; how many of each so far (Naukri allows a few). */
  busy: boolean;
  sends: number;
  codes: number;
  lastSend: number;
  /** How the stream ended, once it has: a code step still waiting then answers by it. */
  outcome?: StreamOutcome;
};

const streams = new Map<string, Entry>();
let server: Server | null = null;
let publicBase: string | null = null;

const MAX_BODY_BYTES = 16 * 1024;
const HEARTBEAT_MS = 15_000;
const bodySchema = z.object({ events: z.array(inputEventSchema).max(64), viewport: viewportSchema.optional(), frames: z.boolean().optional() });
const loginSchema = z.union([z.object({ mobile: z.string().regex(/^\d{10}$/) }), z.object({ saved: z.literal(true) })]);
const codeSchema = z.object({ code: z.string().regex(/^\d{4,8}$/) });
// Naukri's own wait between codes is about 30 s; a few codes and a few tries are all a person needs.
const MAX_SENDS = 4;
const MAX_CODES = 5;
const RESEND_AFTER_MS = 25_000;

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
export function openStream(userId: string, site: Site, stream: ScreenStream, deadline: number, otp: OtpHandlers | null = null) {
  if (!publicBase) throw new Error("The relay is not running");
  const sid = randomBytes(16).toString("base64url");
  streams.set(sid, { userId, site, stream, deadline, viewer: null, unwatch: null, otp, frames: true, busy: false, sends: 0, codes: 0, lastSend: 0 });
  console.log(`relay: stream opened for …${userId.slice(-6)}`);
  return { sid, url: `${publicBase}/stream/${sid}`, end: (outcome: StreamOutcome) => endStream(sid, outcome) };
}

function endStream(sid: string, outcome: StreamOutcome) {
  const entry = streams.get(sid);
  if (!entry) return;
  entry.outcome = outcome;
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
  const match = /^\/stream\/([A-Za-z0-9_-]{16,64})(\/input|\/login|\/code)?$/.exec(url.pathname);
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

  if (input === "/login" || input === "/code") {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    await otpStep(req, res, entry, input === "/login");
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
    if (parsed.frames !== undefined) showFrames(entry, parsed.frames);
    const sent = parsed.events.length ? await entry.stream.input(parsed.events).catch(() => false) : true;
    res.writeHead(sent ? 204 : 409).end();
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }
  const viewport = viewportSchema.safeParse({ width: url.searchParams.get("w"), height: url.searchParams.get("h") });
  if (url.searchParams.get("frames") === "0") entry.frames = false;
  if (viewport.success) await entry.stream.resize(viewport.data).catch(() => undefined);
  // One viewer: a new one (a reload, a second tab) takes over and the old one is told.
  if (entry.viewer && !entry.viewer.writableEnded) {
    entry.unwatch?.();
    entry.viewer.write(`event: replaced\ndata: {}\n\n`);
    entry.viewer.end();
  }
  res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write(`event: open\ndata: ${JSON.stringify({ expiresAt: new Date(entry.deadline).toISOString(), otp: Boolean(entry.otp), savedNumber: entry.otp?.savedNumber ?? null })}\n\n`);
  // Frames are dropped while the phone's connection is behind, never queued: the next one replaces them anyway.
  let blocked = false;
  res.on("drain", () => {
    blocked = false;
  });
  entry.viewer = res;
  entry.unwatch = entry.stream.watch((frame) => {
    if (!entry.frames || blocked || res.writableEnded) return;
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

/** Frames on (the phone shows the page: a check) or off (its own screens). On sends the newest frame at once. */
function showFrames(entry: Entry, on: boolean) {
  const was = entry.frames;
  entry.frames = on;
  if (on && !was && entry.viewer && entry.unwatch) {
    const viewer = entry.viewer;
    entry.unwatch();
    entry.unwatch = entry.stream.watch((frame) => {
      if (!entry.frames || viewer.writableEnded) return;
      viewer.write(`event: frame\ndata: ${JSON.stringify({ d: frame.data, w: frame.width, h: frame.height })}\n\n`);
    });
  }
}

/**
 * OTP connect (K8b): the number or the code, handed to the worker's driver and answered with its outcome. The body is
 * read, checked and passed on; nothing of it is logged or kept here.
 */
async function otpStep(req: IncomingMessage, res: ServerResponse, entry: Entry, login: boolean) {
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  };
  if (!entry.otp) return reply(409, { state: "refused", message: "This sign-in does not take a code." });
  if (entry.busy) return reply(409, { state: "busy" });
  const raw = await readBody(req);
  let body: unknown = null;
  try {
    body = raw === null ? null : JSON.parse(raw);
  } catch {
    body = null;
  }
  if (login) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return reply(400, { state: "refused", message: "Enter your 10-digit mobile number." });
    if (entry.sends >= MAX_SENDS) return reply(429, { state: "refused", message: "That is enough codes for one sign-in. Connect again in a few minutes." });
    const wait = entry.lastSend + RESEND_AFTER_MS - Date.now();
    if (wait > 0) return reply(429, { state: "wait", seconds: Math.ceil(wait / 1000) });
    entry.busy = true;
    entry.sends += 1;
    entry.lastSend = Date.now();
    try {
      const step = await entry.otp.send("mobile" in parsed.data ? parsed.data.mobile : null);
      if (step.state === "check") showFrames(entry, true);
      return reply(200, step);
    } catch {
      return reply(200, { state: "refused", message: "Naukri's login did not answer. Try again in a minute." });
    } finally {
      entry.busy = false;
    }
  }
  const parsed = codeSchema.safeParse(body);
  if (!parsed.success) return reply(400, { state: "refused", message: "Enter the code Naukri texted you." });
  if (entry.codes >= MAX_CODES) return reply(429, { state: "refused", message: "Too many tries for one code. Ask Naukri for a new one." });
  entry.busy = true;
  entry.codes += 1;
  try {
    const step = await entry.otp.enter(parsed.data.code);
    if (step.state === "check") showFrames(entry, true);
    return reply(200, step);
  } catch {
    // The sign-in check can see the user signed in and close the window while this step still waits on the page
    // (25 Nov, in the screen image): the code worked, so it answers so. A page that broke as it left the login gets a
    // few seconds for that check.
    for (let waited = 0; !entry.outcome && waited < 5000; waited += 250) await new Promise((done) => setTimeout(done, 250));
    if (entry.outcome === "connected") return reply(200, { state: "accepted" });
    return reply(200, { state: "refused", message: "Naukri's login did not answer. Try again." });
  } finally {
    entry.busy = false;
  }
}
