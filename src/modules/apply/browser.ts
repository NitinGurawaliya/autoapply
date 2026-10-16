import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { NoRetryError } from "./adapter";

export type OpenBrowser = {
  context: BrowserContext;
  page: Page;
  profileDir: string;
  close: () => Promise<void>;
};

// Profiles live under one root, one folder per user, so cookies and storage are never shared between users.
// Chromium allows one process per profile folder, so concurrent runs of the SAME user each take their own slot.
export const PROFILE_ROOT = process.env.BROWSER_PROFILE_ROOT ?? "./.browser-profiles";
const MAX_SLOTS = 8;
const freeSlotsByOwner = new Map<string, number[]>();

function ownerKey(owner: string) {
  const key = owner.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!key) throw new Error("A browser profile needs an owner");
  return key;
}

function slotsFor(owner: string) {
  let slots = freeSlotsByOwner.get(owner);
  if (!slots) {
    slots = Array.from({ length: MAX_SLOTS }, (_, index) => index);
    freeSlotsByOwner.set(owner, slots);
  }
  return slots;
}

export function profileDirFor(owner: string, slot: number, kind: "chromium" | "chrome" = "chromium") {
  return join(PROFILE_ROOT, ownerKey(owner), kind === "chrome" ? `chrome-slot-${slot}` : `slot-${slot}`);
}

/** A screen to show a window on: always on Windows and macOS; on Linux only with an X or Wayland display (not in Docker). */
export function canShowWindow() {
  return process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `handoff`: a run where the user presses Submit themselves (Ashby, whose spam check refuses submissions an automated
 * browser makes on its own): a visible window in the user's installed Google Chrome, with its own profile folder, or
 * the bundled Chromium when Chrome is not installed. It needs a screen, so it runs only where the worker runs on the
 * user's own computer.
 */
export async function openBrowser(url: string, owner: string, options: { handoff?: boolean } = {}): Promise<OpenBrowser> {
  if (options.handoff && !canShowWindow()) {
    throw new NoRetryError("This form needs you to press Submit yourself, and the worker is running without a screen. Run the worker on your own computer, or open the form and apply by hand.");
  }
  const headed = process.env.DEMO_HEADED === "1" || options.handoff === true;
  let channel: "chrome" | undefined = options.handoff ? "chrome" : undefined;
  const key = ownerKey(owner);
  const free = slotsFor(key);

  let slot: number | undefined;
  let context: BrowserContext | undefined;
  let lastError: unknown;
  // A profile folder stays locked for a moment after its browser closes, and a stale Chromium can hold one.
  // A locked slot goes to the back of the line, and the sweep repeats after a pause before giving up.
  const maxTries = MAX_SLOTS * 3;
  for (let tries = 0; tries < maxTries && !context; tries += 1) {
    if (tries > 0 && tries % MAX_SLOTS === 0) await sleep(1500);
    slot = free.shift();
    if (slot === undefined) {
      await sleep(1500);
      continue;
    }
    try {
      context = await chromium.launchPersistentContext(profileDirFor(key, slot, channel ?? "chromium"), {
        headless: !headed,
        viewport: { width: 1280, height: 800 },
        ...(channel ? { channel } : {}),
      });
    } catch (error) {
      lastError = error;
      // No Google Chrome on this machine: the bundled Chromium, still in a visible window.
      if (channel && /distribution .*chrome.* is not found|chrome.*not found|Executable doesn't exist/i.test(String(error))) {
        channel = undefined;
        free.unshift(slot);
        continue;
      }
      // A profile another browser still holds, or one that died while opening, is a reason to try the next slot.
      if (/already in use|existing browser session|has been closed|singleton|process.*exited|crashed/i.test(String(error))) {
        free.push(slot);
        continue;
      }
      free.unshift(slot);
      throw error;
    }
  }
  if (!context || slot === undefined) {
    throw lastError instanceof Error ? lastError : new Error("No free browser slot; lower APPLY_CONCURRENCY or wait");
  }
  const heldSlot = slot;

  let page: Page;
  try {
    page = await context.newPage();
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  } catch (error) {
    await context.close().catch(() => undefined);
    free.unshift(heldSlot);
    throw error;
  }

  return {
    context,
    page,
    profileDir: profileDirFor(key, heldSlot),
    close: async () => {
      try {
        await context.close();
      } finally {
        free.unshift(heldSlot);
      }
    },
  };
}
