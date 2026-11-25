/**
 * Stealthy browser (17 Nov): a real Chrome started by SeleniumBase in CDP Mode (scripts/seleniumbase_cdp_launcher.py),
 * which Playwright then drives over the DevTools endpoint SeleniumBase reports, the pattern of SeleniumBase's own
 * examples/cdp_mode/playwright (sb_cdp.Chrome → get_endpoint_url → connect_over_cdp → contexts[0].pages[0]).
 * Cloudflare Turnstile on Workable and Ashby's spam check refused the worker's Playwright Chromium even when a person
 * ticked the box; this Chrome starts the way a person's does, with no WebDriver, so the page sees no automation.
 * The default for every board and every kind of run (5 of 5 submits that reached a form went through on the first
 * day: Workable x3, Ashby x2; Greenhouse and Keka since). STEALTHY_BROWSER=0 turns it off; when it cannot start the
 * run is retried unless STEALTHY_FALLBACK=1 lets browser.ts open its Playwright browser.
 *
 * Every launch, attach and close is one line in stealthy-browser.log (STEALTHY_LOG) beside the worker's console, so
 * which browser a run used can be checked at once.
 *
 * Env: STEALTHY_BROWSER (default 1) · STEALTHY_FALLBACK · SELENIUM_CDP_PORT (fixed DevTools port; default SeleniumBase
 * picks a free one per session) · STEALTHY_PYTHON (python executable, default `python`) · STEALTHY_READY_MS (launch
 * timeout, default 90000) · STEALTHY_LOG.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { type ChildProcess, spawn } from "child_process";
import { appendFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

export interface StealthyBrowserSession {
  context: BrowserContext;
  page: Page;
  /** Send a launcher command (GOTO <url>, FRONT, PING) and get its reply line ("OK ..." or "ERR ..."). No CAPTCHA command: a challenge goes to the person. */
  command: (line: string, timeoutMs?: number) => Promise<string>;
  close: () => Promise<void>;
}

const LAUNCHER = path.resolve(process.cwd(), "scripts", "seleniumbase_cdp_launcher.py");

/** The stealthy Chrome is the default for every run; STEALTHY_BROWSER=0 (or false) makes the worker use its Playwright browser. */
export function stealthEnabled(): boolean {
  const value = (process.env.STEALTHY_BROWSER ?? "1").trim().toLowerCase();
  return value !== "0" && value !== "false";
}

/** Cookies and local storage saved by browser.ts for this owner (its storageState shape). */
export type SavedBrowserState = {
  cookies: { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: "Strict" | "Lax" | "None" }[];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STEALTHY_LOG = process.env.STEALTHY_LOG || path.resolve(process.cwd(), "stealthy-browser.log");
function record(line: string) {
  console.log(`stealthy: ${line}`);
  try {
    appendFileSync(STEALTHY_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // a read-only folder: the console line is enough
  }
}

let nextId = 1;

/**
 * Owns one launcher process (one Chrome) and the Playwright connection to it.
 */
export class StealthyBrowserManager {
  readonly id = nextId++;
  private process: ChildProcess | null = null;
  private browser: Browser | null = null;
  private endpoint: string | null = null;
  private buffer = "";
  // A proxied launch's own working folder (SeleniumBase writes the proxy's sign-in extension there), removed on close.
  private workDir: string | null = null;
  // Replies to commands arrive in order, one line each; each waiter takes the next "OK"/"ERR" line.
  private waiters: ((line: string) => void)[] = [];

  constructor(private cdpPort: number = 0) {}

  get port() {
    return this.cdpPort;
  }

  get cdpEndpoint() {
    return this.endpoint;
  }

  private onLine(line: string, ready: { resolve: () => void; reject: (error: Error) => void }) {
    if (line.startsWith("READY ")) {
      this.endpoint = line.slice(6).trim();
      const port = Number(this.endpoint.match(/:(\d+)/)?.[1]);
      if (port) this.cdpPort = port;
      ready.resolve();
      return;
    }
    if (line.startsWith("ERROR")) {
      ready.reject(new Error(line));
      return;
    }
    if (line === "OK QUIT") return;
    if (line.startsWith("OK ") || line.startsWith("ERR ")) {
      const waiter = this.waiters.shift();
      if (waiter) waiter(line);
      else record(`#${this.id} unexpected reply: ${line}`);
      return;
    }
    if (line === "CLOSING") return;
    console.log(`stealthy[#${this.id}]: ${line}`);
  }

  /** Starts Chrome through SeleniumBase on the url and resolves with the DevTools endpoint once the page is open. */
  async launch(url = "about:blank", userDataDir?: string, proxy?: string): Promise<{ cdpEndpoint: string; cleanup: () => Promise<void> }> {
    const python = process.env.STEALTHY_PYTHON || "python";
    const readyMs = Number(process.env.STEALTHY_READY_MS) || 90_000;
    const args = [LAUNCHER];
    if (this.cdpPort) args.push("--port", String(this.cdpPort));
    if (userDataDir) args.push("--profile", userDataDir);
    args.push(url);
    record(`#${this.id} launching SeleniumBase CDP mode${this.cdpPort ? ` on port ${this.cdpPort}` : ""}`);
    // A signed-in site's proxy (modules/sources/egress.ts) goes in the launcher's environment, never its arguments, so the
    // password is not in the process list.
    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" };
    if (proxy) env.STEALTHY_PROXY = proxy;
    else delete env.STEALTHY_PROXY;
    // SeleniumBase writes an authenticated proxy as an extension under its working folder (downloaded_files/proxy_ext_dir),
    // the password in it: each proxied launch gets a fresh folder of its own, so two users' runs never share that file,
    // and it is deleted when this Chrome closes (cleanup).
    if (proxy) this.workDir = mkdtempSync(path.join(tmpdir(), "stealthy-"));
    const child = spawn(python, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env, ...(this.workDir ? { cwd: this.workDir } : {}) });
    this.process = child;

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`SeleniumBase did not report READY within ${readyMs} ms`)), readyMs);
      const settle = { resolve: () => (clearTimeout(timer), resolve()), reject: (error: Error) => (clearTimeout(timer), reject(error)) };
      child.stdout?.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString("utf8");
        let index: number;
        while ((index = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, index).trim();
          this.buffer = this.buffer.slice(index + 1);
          if (line) this.onLine(line, settle);
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8").trim();
        if (text) console.log(`stealthy[#${this.id} py]: ${text.split("\n").slice(-3).join(" | ")}`);
      });
      child.on("error", (error) => settle.reject(error));
      child.on("exit", (code) => {
        settle.reject(new Error(`SeleniumBase launcher exited with code ${code} before READY`));
        // Replies that will never come
        for (const waiter of this.waiters.splice(0)) waiter(`ERR EXIT launcher exited with code ${code}`);
      });
    });

    try {
      await ready;
    } catch (error) {
      await this.cleanup();
      throw error;
    }
    if (!this.endpoint) throw new Error("SeleniumBase reported READY without an endpoint");
    return { cdpEndpoint: this.endpoint, cleanup: () => this.cleanup() };
  }

  /** Attaches Playwright to the Chrome SeleniumBase started. */
  async connectToStealthyBrowser(cdpEndpoint: string): Promise<Browser> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        this.browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 15_000 });
        return this.browser;
      } catch (error) {
        lastError = error;
        await wait(1000);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /** Sends one command line to the launcher and resolves with its reply line. */
  command(line: string, timeoutMs = 60_000): Promise<string> {
    const child = this.process;
    if (!child || child.exitCode !== null || !child.stdin?.writable) return Promise.resolve("ERR launcher not running");
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(`ERR ${line.split(" ")[0]} no reply within ${timeoutMs} ms`);
      }, timeoutMs);
      const waiter = (reply: string) => {
        clearTimeout(timer);
        resolve(reply);
      };
      this.waiters.push(waiter);
      child.stdin!.write(`${line}\n`);
    });
  }

  async cleanup() {
    const child = this.process;
    const browser = this.browser;
    if (browser || child) record(`#${this.id} closing Chrome${this.endpoint ? ` at ${this.endpoint}` : ""}`);
    this.browser = null;
    this.process = null;
    // 1. SeleniumBase quits Chrome itself (sb.quit) on QUIT or on stdin EOF.
    let exited: Promise<void> = Promise.resolve();
    if (child && child.exitCode === null) {
      exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      try {
        child.stdin?.write("QUIT\n");
        child.stdin?.end();
      } catch {
        // stdin closed
      }
    }
    // 2. Playwright disconnects; if Chrome is somehow still up, ask it to close over CDP (browser.close() on a CDP
    //    connection only disconnects; a launcher killed by Ctrl+C once left its window open).
    if (browser) {
      await Promise.race([exited, wait(5000)]);
      if (browser.isConnected()) {
        try {
          const context = browser.contexts()[0];
          const page = context?.pages()[0];
          if (page) {
            const session = await context.newCDPSession(page);
            await Promise.race([session.send("Browser.close"), wait(3000)]);
          }
        } catch {
          // already closing
        }
      }
      await browser.close().catch(() => undefined);
    }
    // 3. The launcher process, with its children, if it is still there.
    if (child && child.exitCode === null) {
      await Promise.race([exited, wait(10_000)]);
      if (child.exitCode === null) {
        try {
          if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          else child.kill();
        } catch {
          // gone
        }
      }
    }
    // 4. A proxied launch's folder, with the proxy's password in it (Chrome may hold it a moment after exit on Windows).
    const workDir = this.workDir;
    this.workDir = null;
    if (workDir) {
      for (let tries = 0; tries < 5; tries += 1) {
        try {
          rmSync(workDir, { recursive: true, force: true });
          break;
        } catch {
          await wait(1000);
        }
      }
      if (existsSync(workDir)) record(`#${this.id} could not remove ${workDir}`);
    }
  }

  /** Stealth mode is the default; STEALTHY_BROWSER=0 (or false) turns it off. */
  static isEnabled(): boolean {
    return stealthEnabled();
  }

  /** The DevTools port: SELENIUM_CDP_PORT when set, else 0 (SeleniumBase picks a free one). */
  static getCdpPort(): number {
    const port = Number(process.env.SELENIUM_CDP_PORT);
    return Number.isFinite(port) && port > 0 ? port : 0;
  }
}

// The sessions open right now, so a shutdown can close them all.
const sessions = new Set<StealthyBrowserManager>();

export function getStealthyBrowserManager(port = StealthyBrowserManager.getCdpPort()): StealthyBrowserManager {
  const manager = new StealthyBrowserManager(port);
  sessions.add(manager);
  return manager;
}

export async function closeAllStealthyBrowsers() {
  await Promise.all([...sessions].map((manager) => manager.cleanup()));
  sessions.clear();
}

/**
 * Opens `url` in a SeleniumBase-started Chrome and returns a Playwright context and page on it, or null (with the
 * reason logged) when stealth mode is off or anything fails, so the caller decides (browser.ts: retry, or the Playwright
 * browser with STEALTHY_FALLBACK=1).
 */
export async function openStealthyBrowser(
  url: string,
  owner: string,
  options: { savedState?: SavedBrowserState; proxy?: string; proxyLabel?: string; prepare?: (context: BrowserContext) => Promise<void> } = {},
): Promise<StealthyBrowserSession | null> {
  if (!StealthyBrowserManager.isEnabled()) return null;

  const manager = getStealthyBrowserManager();
  const done = async () => {
    await manager.cleanup();
    sessions.delete(manager);
  };
  try {
    // Chrome starts on a blank tab so the owner's saved cookies are in place before the form loads.
    const { cdpEndpoint } = await manager.launch("about:blank", undefined, options.proxy);
    if (options.proxyLabel) record(`#${manager.id} through ${options.proxyLabel}`);
    const browser = await manager.connectToStealthyBrowser(cdpEndpoint);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    if (options.savedState?.cookies.length) {
      await context.addCookies(options.savedState.cookies).catch((error) => record(`#${manager.id} saved cookies not restored (${error instanceof Error ? error.message : String(error)})`));
    }
    // Before the first page: what the caller sets on the context (a signed-in site's lean pages, sites/lean.ts).
    if (options.prepare) await options.prepare(context);
    // The form opens through SeleniumBase (its playwright ReadMe: sb.goto over page.goto for stealth); Playwright's
    // own goto is the fallback when the launcher cannot.
    const reply = await manager.command(`GOTO ${url}`, 60_000);
    let page = context.pages().find((candidate) => !candidate.isClosed()) ?? null;
    if (!page) page = await context.newPage();
    if (!reply.startsWith("OK")) {
      record(`#${manager.id} launcher GOTO failed (${reply}); navigating with Playwright`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } else {
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
    }
    await page.bringToFront().catch(() => undefined);
    record(`#${manager.id} attached to Chrome at ${cdpEndpoint} for ${owner}, page ${page.url()}`);
    return {
      context,
      page,
      command: (line, timeoutMs) => manager.command(line, timeoutMs),
      close: done,
    };
  } catch (error) {
    record(`#${manager.id} unavailable for ${owner} (${error instanceof Error ? error.message : String(error)})`);
    await done();
    return null;
  }
}
