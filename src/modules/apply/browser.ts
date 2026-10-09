import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

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

export function profileDirFor(owner: string, slot: number) {
  return join(PROFILE_ROOT, ownerKey(owner), `slot-${slot}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function openBrowser(url: string, owner: string): Promise<OpenBrowser> {
  const headed = process.env.DEMO_HEADED === "1";
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
      context = await chromium.launchPersistentContext(profileDirFor(key, slot), {
        headless: !headed,
        viewport: { width: 1280, height: 800 },
      });
    } catch (error) {
      lastError = error;
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
