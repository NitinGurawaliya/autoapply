import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { z } from "zod";
import { storage } from "@/lib/storage";
import { NoRetryError } from "./adapter";

export type OpenBrowser = {
  context: BrowserContext;
  page: Page;
  /** Where this owner's cookies and local storage are kept between runs (lib/storage.ts). */
  stateKey: string;
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

export function canShowWindow() {
  return process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
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

async function loadState(key: string): Promise<SavedState | undefined> {
  const file = await storage.get(key).catch(() => null);
  if (!file) return undefined;
  try {
    const parsed = stateSchema.safeParse(JSON.parse(Buffer.from(file.bytes).toString("utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// Two runs of one user at once: the one that closes last wins, which loses at most the other run's new cookies.
async function saveState(context: BrowserContext, key: string, owner: string) {
  try {
    const state = await context.storageState();
    let text = JSON.stringify(state);
    if (text.length > MAX_STATE_BYTES) text = JSON.stringify({ cookies: state.cookies, origins: [] });
    if (text.length > MAX_STATE_BYTES) return;
    await storage.put(key, new TextEncoder().encode(text), "application/json", owner);
  } catch {
    /* a closed or crashed context has nothing to save; the previous state stays */
  }
}

/**
 * `handoff`: a run where the user presses Submit themselves (Ashby, whose spam check refuses submissions an automated
 * browser makes on its own): a visible window in the user's installed Google Chrome, or the bundled Chromium when
 * Chrome is not installed. It needs a screen, so it runs only where the worker runs on the user's own computer.
 */
export async function openBrowser(url: string, owner: string, options: { handoff?: boolean; window?: boolean } = {}): Promise<OpenBrowser> {
  if (options.handoff && !canShowWindow() && !autoSubmitAshby()) {
    throw new NoRetryError("This form needs you to press Submit yourself, and the worker is running without a screen. Run the worker on your own computer, or open the form and apply by hand.");
  }
  // `window` (AtsAdapter.window): the same real Chrome window as a handoff, but the worker presses Submit itself.
  const kind = options.handoff || options.window ? "handoff" : "main";
  const stateKey = stateKeyFor(owner);
  const savedState = await loadState(stateKey);

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
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await saveState(context, stateKey, owner);
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

  return { context, page, stateKey, close };
}
