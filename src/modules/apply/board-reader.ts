/**
 * Board reads from inside the stealthy Chrome (23 Nov). Workday's Cloudflare has answered this server's API reads with
 * its bot check since 17 Nov (429, `cf-mitigated: challenge`), while a person's browser gets the same JSON: the career
 * site's page calls the very endpoint the fetcher reads. So the read is made the way the page makes it: the
 * SeleniumBase Chrome (real-browser.ts) opens the tenant's career site, and every API request is a same-origin `fetch`
 * run in that page, with its cookies and clearance. One Chrome serves a whole run: it moves to the next tenant's
 * origin when the request's origin changes. A challenge page that does not clear by itself goes to the person at the
 * window (owner's rule: nothing solves a challenge); after CHALLENGE_WAIT_MS the read is reported `refused`, which
 * cadence.ts treats as "say nothing about the company".
 *
 * Worker and scripts only (Playwright): never imported by the web. Run: scripts/ingest-workday-browser.ts.
 */
import type { Page } from "playwright";
import type { BoardHttp, HttpReply } from "@/modules/jobs/normalize";
import { openStealthyBrowser, type StealthyBrowserSession } from "./real-browser";

const CHALLENGE_WAIT_MS = Number(process.env.BOARD_READER_CHALLENGE_MS) || 90_000;
const CHALLENGE = /just a moment|attention required|verify you are human|checking your browser|enable javascript and cookies/i;

type InPageReply = { status: number; ok: boolean; headers: Record<string, string>; text: string };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface StealthyBoardReader {
  http: BoardHttp;
  /** Origins opened so far and the reads made: the run's report. */
  stats: { origins: number; requests: number; refused: number };
  close: () => Promise<void>;
}

/** The page is Cloudflare's interstitial rather than the site. */
async function onChallenge(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => "");
  if (CHALLENGE.test(title)) return true;
  const text = await page.evaluate(() => document.body?.innerText.slice(0, 2000) ?? "").catch(() => "");
  return CHALLENGE.test(text) && text.length < 1500;
}

/**
 * Opens the stealthy Chrome and returns a transport whose every request runs as a `fetch` inside the page of the
 * request's own origin. `landing(url)`: the page to open when a request reaches a new origin (the career site, so
 * the tenant's own page sets its cookies), given that first request's address; by default the origin itself.
 */
export async function openStealthyBoardReader(owner: string, options: { landing?: (url: URL) => string } = {}): Promise<StealthyBoardReader | null> {
  const session: StealthyBrowserSession | null = await openStealthyBrowser("about:blank", owner);
  if (!session) return null;
  const stats = { origins: 0, requests: 0, refused: 0 };
  let current = "";
  // Requests run one at a time: the page is one tab, and a board is read gently anyway.
  let chain: Promise<unknown> = Promise.resolve();

  const open = async (origin: string, first: URL) => {
    const url = options.landing?.(first) ?? `${origin}/`;
    const reply = await session.command(`GOTO ${url}`, 60_000);
    if (!reply.startsWith("OK")) await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    else await session.page.waitForLoadState("domcontentloaded", { timeout: 45_000 }).catch(() => undefined);
    stats.origins += 1;
    // Cloudflare's managed challenge clears itself in a real Chrome within a few seconds; an interactive one is for
    // the person at the window.
    const started = Date.now();
    while (await onChallenge(session.page)) {
      if (Date.now() - started > CHALLENGE_WAIT_MS) {
        stats.refused += 1;
        throw new Error(`${new URL(origin).hostname} refused (bot check in the stealthy Chrome, not cleared in ${Math.round(CHALLENGE_WAIT_MS / 1000)} s)`);
      }
      await wait(1000);
    }
    // A site that sent the browser elsewhere cannot be read from its own page: the request would be cross-site and the
    // browser blocks it ("Failed to fetch"). 23 Nov, Qualcomm: Workday's maintenance page (community.workday.com).
    const landed = new URL(session.page.url());
    if (landed.origin !== origin) throw new Error(`${new URL(origin).hostname} not available: the career site sent the browser to ${landed.hostname}${landed.pathname}`);
    current = origin;
  };

  const request = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<HttpReply> => {
    const address = new URL(url);
    if (address.origin !== current) await open(address.origin, address);
    stats.requests += 1;
    const reply = await session.page.evaluate(
      async ({ url, init }) => {
        const response = await fetch(url, { method: init?.method ?? "GET", headers: init?.headers, body: init?.body, credentials: "include" });
        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => (headers[name.toLowerCase()] = value));
        return { status: response.status, ok: response.ok, headers, text: await response.text() } as InPageReply;
      },
      { url, init },
    );
    if (reply.status === 429 || (reply.status === 403 && reply.headers["cf-mitigated"])) {
      stats.refused += 1;
      // The clearance may have lapsed: the next request on this origin opens the site again.
      current = "";
    }
    return {
      status: reply.status,
      ok: reply.ok,
      headers: { get: (name) => reply.headers[name.toLowerCase()] ?? null },
      json: async () => JSON.parse(reply.text) as unknown,
    };
  };

  const http: BoardHttp = {
    fetch: (url, init) => {
      const next = chain.then(() => request(url, init));
      chain = next.catch(() => undefined);
      return next;
    },
  };
  return { http, stats, close: () => session.close() };
}
