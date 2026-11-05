import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { z } from "zod";
import { seal, unseal } from "@/lib/sealed";
import { storage } from "@/lib/storage";
import { onSiteDomain, siteStateKey, type Site } from "@/modules/sources/sites";
import { NoRetryError } from "./adapter";

export type OpenBrowser = {
  context: BrowserContext;
  page: Page;
  /** Where this owner's cookies and local storage are kept between runs (lib/storage.ts). */
  stateKey: string;
  /** A saved state was found and opened into this context (false: a fresh one). */
  restored: boolean;
  /** Saves the context's state now; false when nothing could be saved. A signed-in site saves only its own cookies. */
  saveState: () => Promise<boolean>;
  close: () => Promise<void>;
};

// One Chromium per worker process, one incognito context per run (T100, 18 Oct): a context costs a fraction of a
// browser (8 runs at once: 40 processes and 2.0 GB as 8 browsers), and contexts never share cookies or storage.
// A user's cookies and local storage live in storage, not in a folder on this machine, so any worker can run them.
// Still a local folder: the worker's pid lock (worker/single.ts), and old per-user profile folders the reaper removes.
export const PROFILE_ROOT = process.env.BROWSER_PROFILE_ROOT ?? "./.browser-profiles";

// A long-lived Chromium slowly grows; it is replaced after this many runs, once its last run has closed.
const RECYCLE_AFTER = Number(process.env.BROWSER_RECYCLE_AFTER) || 200;
// Cookies are kilobytes; local storage of some sites is not. Beyond this only the cookies are kept.
const MAX_STATE_BYTES = 512 * 1024;

function ownerKey(owner: string) {
  const key = owner.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!key) throw new Error("A browser needs an owner");
  return key;
}

export function stateKeyFor(owner: string) {
  return `browser-state/${ownerKey(owner)}.json`;
}

/** A screen to show a window on: always on Windows and macOS; on Linux only with an X or Wayland display (not in Docker). */
/** The page still open in this page's window: itself, or the one Chrome replaced it with; null when the window is gone. */
export function livePage(page: Page): Page | null {
  if (!page.isClosed()) return page;
  return page.context().pages().filter((open) => !open.isClosed()).at(-1) ?? null;
}

/**
 * Whether a window this worker opens is seen on a screen. Linux needs a display: a desktop, or a Docker worker given the
 * host's (docs/DEPLOY.md, "Docker worker with a screen": WSLg's X server on Windows, the X socket on a Linux desktop).
 * A local X display (":0") counts only while its socket is there, so a container whose mount is missing stays headless
 * and leaves protected Ashby to a worker that can show it, instead of failing to open a window.
 */
export function canShowWindow() {
  if (process.platform !== "linux") return true;
  if (process.env.WAYLAND_DISPLAY && process.env.XDG_RUNTIME_DIR && existsSync(join(process.env.XDG_RUNTIME_DIR, process.env.WAYLAND_DISPLAY))) return true;
  const display = process.env.DISPLAY?.match(/^:(\d+)/);
  if (display) return existsSync(`/tmp/.X11-unix/X${display[1]}`);
  return Boolean(process.env.DISPLAY);
}

/**
 * ASHBY_AUTO_SUBMIT=1: the worker presses Ashby's Submit itself (adapters/ashby.ts), so a worker without a screen can take
 * the handoff queue too, in a headless browser. Off by default: a person presses Submit.
 */
export function autoSubmitAshby() {
  return process.env.ASHBY_AUTO_SUBMIT === "1";
}

type Shared = { browser: Promise<Browser>; opened: number; open: number; retiring: boolean };
const shared = new Map<"main" | "handoff", Shared>();

async function launch(kind: "main" | "handoff"): Promise<Browser> {
  // A handoff window is visible where there is a screen; a worker without one (ASHBY_AUTO_SUBMIT) runs it headless.
  const headless = !(process.env.DEMO_HEADED === "1" || (kind === "handoff" && canShowWindow()));
  if (kind === "handoff") {
    // Maximized, with the page sized to the window (no fixed viewport): a 1280x800 page in a smaller window hid the
    // Submit button below the screen's edge (21 Oct).
    const args = ["--start-maximized"];
    try {
      return await chromium.launch({ headless, channel: "chrome", args });
    } catch (error) {
      // No Google Chrome on this machine: the bundled Chromium, still in a visible window.
      if (!/distribution .*chrome.* is not found|chrome.*not found|Executable doesn't exist/i.test(String(error))) throw error;
    }
    return chromium.launch({ headless, args });
  }
  // A visible main browser (DEMO_HEADED=1: every board in a window) is Google Chrome too where the machine has it.
  if (!headless) return chromium.launch({ headless, channel: "chrome" }).catch(() => chromium.launch({ headless }));
  return chromium.launch({ headless });
}

function sharedBrowser(kind: "main" | "handoff"): Shared {
  const current = shared.get(kind);
  if (current && !current.retiring) return current;
  const entry: Shared = { browser: launch(kind), opened: 0, open: 0, retiring: false };
  shared.set(kind, entry);
  entry.browser.then(
    // A crashed or killed browser is forgotten, so the next run launches a new one.
    (browser) => browser.on("disconnected", () => {
      if (shared.get(kind) === entry) shared.delete(kind);
    }),
    () => {
      if (shared.get(kind) === entry) shared.delete(kind);
    },
  );
  return entry;
}

async function release(kind: "main" | "handoff", entry: Shared) {
  entry.open -= 1;
  if (entry.retiring && entry.open === 0) {
    const browser = await entry.browser.catch(() => null);
    await browser?.close().catch(() => undefined);
  }
}

const stateSchema = z.object({
  cookies: z.array(z.object({ name: z.string(), value: z.string(), domain: z.string(), path: z.string(), expires: z.number(), httpOnly: z.boolean(), secure: z.boolean(), sameSite: z.enum(["Strict", "Lax", "None"]) })),
  origins: z.array(z.object({ origin: z.string(), localStorage: z.array(z.object({ name: z.string(), value: z.string() })) })),
});
type SavedState = z.infer<typeof stateSchema>;

/**
 * A saved state, read back. A signed-in site's state (Naukri) is encrypted (lib/sealed.ts, bound to its storage key);
 * one that does not open (another key, changed, no key on this worker) is treated as no state: the run then meets the
 * site's login page and the connection asks the user to sign in again, never anything guessed.
 */
async function loadState(key: string, site?: Site): Promise<SavedState | undefined> {
  const file = await storage.get(key).catch(() => null);
  if (!file) return undefined;
  try {
    const bytes = site ? unseal(file.bytes, key) : file.bytes;
    if (!bytes) return undefined;
    const parsed = stateSchema.safeParse(JSON.parse(Buffer.from(bytes).toString("utf8")));
    if (!parsed.success) return undefined;
    return site ? onlySite(parsed.data, site) : parsed.data;
  } catch {
    return undefined;
  }
}

/** Only the site's own cookies and storage: a Naukri sign-in never carries another site's cookies, nor the reverse. */
export function onlySite(state: SavedState, site: Site): SavedState {
  return {
    cookies: state.cookies.filter((cookie) => onSiteDomain(cookie.domain, site)),
    origins: state.origins.filter((origin) => {
      try {
        return onSiteDomain(new URL(origin.origin).hostname, site);
      } catch {
        return false;
      }
    }),
  };
}

// Two runs of one user at once: the one that closes last wins, which loses at most the other run's new cookies.
async function saveState(context: BrowserContext, key: string, owner: string, site?: Site) {
  try {
    const raw = await context.storageState();
    // The ATS jar is kept exactly as Playwright gives it, as before; a site's sign-in only its own domain's part.
    const state = site ? onlySite(stateSchema.parse(raw), site) : raw;
    let text = JSON.stringify(state);
    if (text.length > MAX_STATE_BYTES) text = JSON.stringify({ cookies: state.cookies, origins: [] });
    if (text.length > MAX_STATE_BYTES) return false;
    const plain = new TextEncoder().encode(text);
    if (site) await storage.put(key, seal(plain, key), "application/octet-stream", owner);
    else await storage.put(key, plain, "application/json", owner);
    return true;
  } catch {
    /* a closed or crashed context has nothing to save, or this worker has no BROWSER_STATE_KEY; the previous state stays */
    return false;
  }
}

/**
 * `handoff`: a run where the user presses Submit themselves (Ashby, whose spam check refuses submissions an automated
 * browser makes on its own): a visible window in the user's installed Google Chrome, or the bundled Chromium when
 * Chrome is not installed. It needs a screen, so it runs only where the worker runs on the user's own computer.
 *
 * `site`: the user's own account on a signed-in job site (Naukri; docs/naukri/TDD.md 4.5): its own saved sign-in,
 * encrypted, apart from the ATS cookie jar, and always the visible window. `fresh`: start with no saved state (signing
 * in). `persist: false`: closing does not save (a sign-in that did not finish must not replace a good one).
 */
export async function openBrowser(
  url: string,
  owner: string,
  options: { handoff?: boolean; window?: boolean; site?: Site; fresh?: boolean; persist?: boolean } = {},
): Promise<OpenBrowser> {
  if (options.handoff && !canShowWindow() && !autoSubmitAshby()) {
    throw new NoRetryError("This form needs you to press Submit yourself, and the worker is running without a screen. Run the worker on your own computer, or open the form and apply by hand.");
  }
  if (options.site && !canShowWindow()) {
    throw new NoRetryError("Your job-site account is used only in a window on a computer with a screen, and this worker has none.");
  }
  // `window` (AtsAdapter.window): the same real Chrome window as a handoff, but the worker presses Submit itself.
  const kind = options.handoff || options.window || options.site ? "handoff" : "main";
  const site = options.site;
  const stateKey = site ? siteStateKey(owner, site) : stateKeyFor(owner);
  const savedState = options.fresh ? undefined : await loadState(stateKey, site);

  let entry = sharedBrowser(kind);
  let context: BrowserContext | undefined;
  for (let tries = 0; tries < 2 && !context; tries += 1) {
    try {
      const browser = await entry.browser;
      // A visible window takes the screen's size; headless (no screen) keeps the fixed page every form was tried at.
      const viewport = kind === "handoff" && canShowWindow() ? null : { width: 1280, height: 800 };
      context = await browser.newContext({ viewport, ...(savedState ? { storageState: savedState } : {}) });
    } catch (error) {
      // The shared browser died between runs: launch a new one once.
      if (tries > 0 || !/has been closed|disconnected|crashed|Target closed/i.test(String(error))) throw error;
      if (shared.get(kind) === entry) shared.delete(kind);
      entry = sharedBrowser(kind);
    }
  }
  if (!context) throw new Error("Could not open a browser");
  entry.open += 1;
  entry.opened += 1;
  if (entry.opened >= RECYCLE_AFTER) entry.retiring = true;
  const held = entry;

  let closed = false;
  const save = () => (closed ? Promise.resolve(false) : saveState(context, stateKey, owner, site));
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      if (options.persist !== false) await saveState(context, stateKey, owner, site);
      await context.close().catch(() => undefined);
    } finally {
      await release(kind, held);
    }
  };

  let page: Page;
  try {
    page = await context.newPage();
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  } catch (error) {
    closed = true;
    await context.close().catch(() => undefined);
    await release(kind, held);
    throw error;
  }

  return { context, page, stateKey, restored: Boolean(savedState), saveState: save, close };
}
