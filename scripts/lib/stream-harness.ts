// K8 checks' shared pieces: a local login page standing in for Naukri's, a phone that watches the stream and sends
// taps and keys the way the Account sheet does, and the relay's settings for a run on this machine.
import { randomBytes, randomInt } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "playwright";
import { livePage } from "../../src/modules/apply/browser";
import type { waitForSignIn } from "../../src/modules/apply/sites/naukri";

export const APP_ORIGIN = "http://localhost:3999";
export const PHONE = { width: 390, height: 760 };

/** Where the fake page's fields sit, in CSS pixels (absolutely placed, so a tap can aim without reading the page). */
export const FIELD = { user: { x: 170, y: 120 }, pass: { x: 170, y: 200 }, otp: { x: 170, y: 280 } };

async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** The relay's environment for a run on this machine: direct egress, a throwaway secret, a free port. */
export async function relayEnv() {
  const port = await freePort();
  process.env.SIGNED_IN_PROXY_URL = "off";
  process.env.SOURCE_STREAM_SECRET = randomBytes(32).toString("base64url");
  process.env.SOURCE_STREAM_PORT = String(port);
  process.env.SOURCE_STREAM_PUBLIC_URL = `http://127.0.0.1:${port}`;
  process.env.APP_URL = APP_ORIGIN;
  if (!process.env.BROWSER_STATE_KEY) process.env.BROWSER_STATE_KEY = randomBytes(32).toString("base64");
  return port;
}

/** Made-up sign-in details for one run, unique enough to search logs and storage for. */
export function secrets() {
  const tag = randomBytes(6).toString("hex");
  return { user: `k8smoke.${tag}@example.test`, pass: `Pw-${tag}-x9`, otp: String(randomInt(100000, 999999)) };
}

const LOGIN_PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;font:16px sans-serif;background:#fff}
input,button{position:absolute;left:20px;width:300px;height:40px;font-size:16px;box-sizing:border-box}
#u{top:100px}#p{top:180px}#o{top:260px}button{top:340px}
</style></head><body><form method="post" action="/signin"><input id="u" name="u"><input id="p" name="p" type="password"><input id="o" name="o"><button>Login</button></form></body></html>`;

/** A login page on this machine: user, password and OTP, posted to itself; success lands on /home. It logs nothing. */
export async function fakeLogin() {
  let received: { u: string; p: string; o: string } | null = null;
  const server: Server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/signin") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const form = new URLSearchParams(body);
        received = { u: form.get("u") ?? "", p: form.get("p") ?? "", o: form.get("o") ?? "" };
        res.writeHead(302, { Location: "/home" }).end();
      });
      return;
    }
    if (req.url === "/home") {
      res.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><meta name="viewport" content="width=device-width"><h1>Welcome</h1>`);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" }).end(LOGIN_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/login`,
    received: () => received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * The fake page's sign-in test, in place of Naukri's (sites/naukri.ts waitForSignIn): the window reached /home. Like
 * the real one it never reads the form; on success it adds a naukri.com cookie, so the sealed save has something to keep.
 */
export const fakeWaitForSignIn: typeof waitForSignIn = async (page: Page, timeoutMs, cancelled) => {
  const deadline = Date.now() + timeoutMs;
  let lastCancelCheck = 0;
  while (Date.now() < deadline) {
    const current = livePage(page);
    if (!current) return { status: "closed" };
    if (Date.now() - lastCancelCheck > 1000) {
      lastCancelCheck = Date.now();
      if (await cancelled()) return { status: "cancelled" };
    }
    if (new URL(current.url()).pathname === "/home") {
      await current.context().addCookies([{ name: "k8-marker", value: "v", domain: ".naukri.com", path: "/", secure: true, httpOnly: false, sameSite: "Lax", expires: -1 }]);
      return { status: "signed_in", accountLabel: "Smoke" };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { status: "timeout" };
};

type Frame = { d: string; w: number; h: number };

/** The phone: opens the stream with the pass the web app gave it, keeps count of frames, sends input as the sheet does. */
export class Phone {
  frames = 0;
  lastFrame: Frame | null = null;
  events: string[] = [];
  endOutcome: string | null = null;
  private controller = new AbortController();
  private reading: Promise<void> | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly origin = APP_ORIGIN,
  ) {}

  /** Opens the stream; resolves with the HTTP status (200 when it streams). */
  async open(size = PHONE) {
    const response = await fetch(`${this.url}?w=${size.width}&h=${size.height}`, {
      headers: { Authorization: `Bearer ${this.token}`, Origin: this.origin },
      signal: this.controller.signal,
    });
    if (response.status !== 200 || !response.body) return response.status;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    this.reading = (async () => {
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let cut = buffer.indexOf("\n\n");
        while (cut >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const name = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (name) this.events.push(name);
          if (name === "frame" && data) {
            this.frames += 1;
            this.lastFrame = JSON.parse(data) as Frame;
          }
          if (name === "end" && data) this.endOutcome = (JSON.parse(data) as { outcome: string }).outcome;
          cut = buffer.indexOf("\n\n");
        }
      }
    })();
    return 200;
  }

  /** Resolves once `predicate` holds, or false after `ms`. */
  async until(predicate: () => boolean, ms = 20_000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return predicate();
  }

  async input(events: unknown[], token = this.token, origin = this.origin) {
    const response = await fetch(`${this.url}/input`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });
    return response.status;
  }

  /** Types a string the way the sheet does: characters as text, nothing else. */
  type(text: string) {
    return this.input([{ t: "text", s: text }]);
  }

  async close() {
    this.controller.abort();
    await this.reading?.catch(() => undefined);
  }
}

/** Every line written to this process's stdout and stderr from now on (the worker's log, as far as this run goes). */
export function captureLogs() {
  const lines: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    lines.push(String(chunk));
    return (out as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    lines.push(String(chunk));
    return (err as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;
  return {
    text: () => lines.join(""),
    stop: () => {
      process.stdout.write = out;
      process.stderr.write = err;
    },
  };
}
