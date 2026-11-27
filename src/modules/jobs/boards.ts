import { fetchAshby } from "./fetchers/ashby";
import { fetchGreenhouse, fetchGreenhouseList, greenhouseListHash } from "./fetchers/greenhouse";
import { fetchLever } from "./fetchers/lever";
import { fetchSmartRecruiters, smartRecruitersName, smartRecruitersSlugOf } from "./fetchers/smartrecruiters";
import { fetchWorkable, workableName, workableSlugOf } from "./fetchers/workable";
import { fetchWorkday, workdayName, workdaySlugOf } from "./fetchers/workday";
import { fetchKeka, kekaName, kekaSlugOf } from "./fetchers/keka";
import { fetchZohoRecruit, zohoName, zohoSlugOf } from "./fetchers/zohorecruit";
import { classifyTitle } from "./functions";
import type { BoardHttp, FetchedJob } from "./normalize";
import { tagPosting } from "./tagging";

/**
 * Every public job board we take jobs from, in one place (T91): how its jobs are fetched, which jobs are stored, the
 * hosts its application forms may open on, and how discovery finds new companies on it. Adding a board is one entry
 * here plus a fetcher and an adapter (docs/INGEST_CONTRACT.md).
 */

export type BoardSource = "greenhouse" | "lever" | "ashby" | "workday" | "zohorecruit" | "keka" | "smartrecruiters" | "workable" | "naukri" | "hirist";

/** How discovery (discovery.ts) checks names against a board. */
export type BoardDiscovery = {
  boardUrl: string;
  /** The open jobs on this slug's board, or null when the slug is not a board. */
  open: (slug: string) => Promise<FetchedJob[] | null>;
  /** The jobs that count for the rule, and how many make a company worth adding. */
  counts: (job: FetchedJob) => boolean;
  minIndiaJobs: number;
  /** One of them posted in the last 30 days (discovery's FRESH_DAYS). */
  needsFresh: boolean;
  /** Board names also come from the Common Crawl index of these hosts (discovery.ts slugsFromCrawl). */
  crawlHosts?: string[];
  /** The slug of a crawled address, when it is not the address's first path part (Workday, Zoho: the host). Null: not a board. */
  slugFromUrl?: (url: URL) => string | null;
  /** Index pages read per crawl and host (Workday's hosts list millions of pages); all when unset. */
  crawlPages?: number;
  /** False: the model is not asked for names (a board address it cannot guess, such as Workday's tenant and site). */
  fromModel?: boolean;
  /** The company's own name for a board known only by its slug (from the crawl), or null. */
  nameOf?: (slug: string) => Promise<string | null>;
};

export type Board = {
  source: BoardSource;
  label: string;
  /** Every open job on the company's board. `known`: postings ingest already holds, which a board with a list-then-detail
   * API (Workday) returns from its list alone, marked `listOnly`, instead of reading each one again (M2). */
  fetch: (slug: string, options?: { known?: ReadonlySet<string>; http?: BoardHttp }) => Promise<FetchedJob[]>;
  /** A hash of the board's cheap list (ids and update times), for boards whose full read is heavy (Greenhouse, M2):
   * when it equals the company's `listHash`, nothing changed and the full read is skipped. */
  probe?: (slug: string) => Promise<string>;
  /** Which fetched jobs ingest stores; the rest are dropped (India-eligible by default since M2; companies with
   * `keepAbroad` store everything, ingest.ts storedFromBoard). */
  stores: (job: FetchedJob) => boolean;
  /** The hosts this board's application forms are on: the worker opens nothing else for its jobs (apply/urls.ts). */
  formHost: RegExp;
  /** How a company name or slug is written as this board's slug. */
  slugOf: (text: string) => string;
  discovery?: BoardDiscovery;
  /**
   * Read per user through the user's own signed-in account (Phase K: Naukri), never per company: its companies are stored
   * inactive, so the company ingest never fetches them (ingest.ts ingestForUser reads them instead).
   */
  perUser?: boolean;
};

// Discovery is polite: a pause after every request it makes to a board.
const PAUSE_MS = 300;
// Workable answers 429 after a few hundred calls in minutes (10 Nov), so its checks are spaced further apart.
const WORKABLE_PAUSE_MS = 2000;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Discovery's check of one board: a board that is not there answers 404 or 410, or has no portal page (Keka, Zoho), and
 * is null here. Anything else (a 429 rate limit, a 5xx, a timeout) is a failed check, retried later, never "not a board":
 * Workable on 10 Nov (124 accounts read as gone after ~250 calls) and Workday on 17 Nov (48 of 50 recorded tenants read as
 * gone during a 429) both lost real boards that way.
 */
async function openOrGone(read: () => Promise<FetchedJob[] | null>, pauseMs = PAUSE_MS): Promise<FetchedJob[] | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof Error && (/ (404|410)$/.test(error.message) || /: no portal$/.test(error.message))) return null;
    throw error;
  } finally {
    await pause(pauseMs);
  }
}

/** The minimum India-eligible open jobs for discovery to add a Greenhouse company (owner, 11 Oct). */
export const MIN_INDIA_JOBS = 3;

export const indiaEligible = (job: FetchedJob) => {
  const { eligibility } = tagPosting(job);
  return eligibility === "india" || eligibility === "remote_india";
};

/**
 * Ashby boards are mostly US and non-tech roles: only tech jobs a candidate in India can take are stored from Ashby
 * (owner, 15 Oct). Jobs stored before stay.
 */
const indiaTech = (job: FetchedJob) => indiaEligible(job) && classifyTitle(job.title).function !== "non_tech";

export const BOARDS: Board[] = [
  {
    source: "greenhouse",
    label: "Greenhouse",
    fetch: fetchGreenhouse,
    probe: greenhouseListHash,
    // India-eligible only since M2 (owner, 9 Nov); the companies watched before keep abroad jobs (`keepAbroad`).
    stores: indiaEligible,
    formHost: /^(job-boards|boards)(\.eu)?\.greenhouse\.io$/i,
    slugOf: (text) => text.toLowerCase().replace(/[^a-z0-9]/g, ""),
    discovery: {
      boardUrl: "boards.greenhouse.io/<slug>",
      async open(slug) {
        // The list without descriptions (M3): enough to count India jobs; a board that is not there answers 404.
        return openOrGone(() => fetchGreenhouseList(slug));
      },
      counts: indiaEligible,
      minIndiaJobs: MIN_INDIA_JOBS,
      needsFresh: true,
      // Boards live on both hosts; the crawl finds slugs the model never proposes (T92).
      crawlHosts: ["job-boards.greenhouse.io", "boards.greenhouse.io"],
      // The boards API names the company ("addepar1" → "Addepar").
      async nameOf(slug) {
        const body = (await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { name?: unknown } | null;
        await pause(PAUSE_MS);
        return typeof body?.name === "string" && body.name.trim() ? body.name.trim() : null;
      },
    },
  },
  {
    source: "lever",
    label: "Lever",
    fetch: fetchLever,
    stores: indiaEligible,
    formHost: /^jobs(\.eu)?\.lever\.co$/i,
    slugOf: (text) => text.toLowerCase().replace(/[^a-z0-9.-]/g, ""),
    // Lever is where many Indian startups post (Paytm, Meesho, Zeta, CRED; probe of 18 Oct). Same bar as Greenhouse:
    // Lever boards are stored whole, so a company is added only when it really hires in India (T92).
    discovery: {
      boardUrl: "jobs.lever.co/<slug>",
      async open(slug) {
        // The public postings API ingest uses; an unknown slug answers 404, a board with no openings an empty list.
        return openOrGone(() => fetchLever(slug));
      },
      counts: indiaEligible,
      minIndiaJobs: MIN_INDIA_JOBS,
      needsFresh: true,
      crawlHosts: ["jobs.lever.co"],
      // The public board page's title is the company's name ("Shield AI").
      async nameOf(slug) {
        const html = await fetch(`https://jobs.lever.co/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
        await pause(PAUSE_MS);
        return html.match(/<title>([^<]{1,140})<\/title>/i)?.[1]?.trim() || null;
      },
    },
  },
  {
    source: "ashby",
    label: "Ashby",
    fetch: fetchAshby,
    stores: indiaTech,
    formHost: /^jobs\.ashbyhq\.com$/i,
    // Ashby slugs keep dots and hyphens ("perplexity-ai", "fly.io").
    slugOf: (text) => text.toLowerCase().replace(/[^a-z0-9.-]/g, ""),
    discovery: {
      boardUrl: "jobs.ashbyhq.com/<slug>",
      async open(slug) {
        // The same public posting API ingest uses; an unknown slug answers 404.
        return openOrGone(() => fetchAshby(slug));
      },
      // Ashby: one India tech job is enough, the jobs ingest stores from Ashby (owner, 15 Oct: as many companies as
      // possible). Few Ashby companies hire in India, so the Greenhouse bar would add almost none.
      counts: indiaTech,
      minIndiaJobs: 1,
      needsFresh: false,
      crawlHosts: ["jobs.ashbyhq.com"],
      // The public board page's title is "<Company> Jobs" ("TELUS Digital Jobs"); the slug alone reads "telus-digital".
      async nameOf(slug) {
        const html = await fetch(`https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
        await pause(PAUSE_MS);
        const title = html.match(/<title>([^<]{1,140})<\/title>/i)?.[1]?.replace(/\s*\bJobs\s*$/i, "").trim();
        if (title) return title;
        // Some boards are titled just "Jobs": the slug, spaced and capitalised ("real-fast" → "Real Fast").
        return slug.split(/[-.]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ") || null;
      },
    },
  },
  {
    // Workday (T99): public CXS API, no login; 35% of the jobs in tsenta.com's index (18 Oct). Discovery and ingest
    // only: applying needs an account per employer, so no adapter and never in APPLY_BOARDS. Tenants are large MNCs
    // with jobs worldwide: only India-eligible jobs are stored (the fetcher already asks for the India facet).
    source: "workday",
    label: "Workday",
    // `http`: the stealthy Chrome's transport when the read runs inside it (scripts/ingest-workday-browser.ts), the
    // way past Cloudflare's refusal of this server; its requests are paced like the page's own, half a second apart.
    fetch: (slug, options) => fetchWorkday(slug, { known: options?.known, http: options?.http, ...(options?.http ? { pauseMs: 500 } : {}) }),
    stores: indiaEligible,
    formHost: /^[a-z0-9-]+\.wd\d{1,3}\.myworkdayjobs\.com$/i,
    // "{tenant}.{wdN}/{site}"; the site keeps its case ("NVIDIAExternalCareerSite").
    slugOf: (text) => text.trim().replace(/[^A-Za-z0-9./_-]/g, ""),
    discovery: {
      boardUrl: "<tenant>.<wdN>.myworkdayjobs.com/<site>",
      async open(slug) {
        // The list alone (one request a page): enough to count India jobs and their age.
        if (!/^[a-z0-9-]+\.wd\d{1,3}\/[A-Za-z0-9_-]+$/.test(slug)) return null;
        return openOrGone(() => fetchWorkday(slug, { details: false }));
      },
      counts: indiaEligible,
      minIndiaJobs: MIN_INDIA_JOBS,
      needsFresh: true,
      crawlHosts: ["*.myworkdayjobs.com"],
      slugFromUrl: workdaySlugOf,
      crawlPages: 30,
      fromModel: false,
      async nameOf(slug) {
        const name = await workdayName(slug).catch(() => null);
        await pause(PAUSE_MS);
        return name;
      },
    },
  },
  {
    // Zoho Recruit (T99): the newest Indian listings in tsenta.com's index are mostly Zoho portals. The public portal
    // page carries its openings as JSON (fetchers/zohorecruit.ts). Applied on by adapters/zohorecruit.ts (M13). Many
    // .com portals are US firms: only India-eligible jobs are stored.
    source: "zohorecruit",
    label: "Zoho Recruit",
    fetch: fetchZohoRecruit,
    stores: indiaEligible,
    formHost: /^[a-z0-9-]+\.zohorecruit\.(in|com|eu|com\.au|jp)$/i,
    // The portal host; a bare name is its .in portal (the model's guesses: "Arting Digital" → artingdigital.zohorecruit.in).
    slugOf: (text) => {
      const lower = text.trim().toLowerCase();
      return lower.includes(".zohorecruit.") ? lower.replace(/[^a-z0-9./_-]/g, "") : `${lower.replace(/[^a-z0-9-]/g, "")}.zohorecruit.in`;
    },
    discovery: {
      boardUrl: "<company>.zohorecruit.in/jobs/Careers",
      async open(slug) {
        // An unknown host has no portal: fetchZohoRecruit throws, which is null here.
        return openOrGone(() => fetchZohoRecruit(slug));
      },
      // Small Indian companies with a few openings each: one fresh India job is enough.
      counts: indiaEligible,
      minIndiaJobs: 1,
      needsFresh: true,
      crawlHosts: ["*.zohorecruit.in", "*.zohorecruit.com"],
      slugFromUrl: zohoSlugOf,
      async nameOf(slug) {
        const name = await zohoName(slug);
        await pause(PAUSE_MS);
        return name;
      },
    },
  },
  {
    // Keka (T96): an Indian HR suite; its careers portal lists every open job as public JSON (fetchers/keka.ts). Its
    // application form has an image CAPTCHA, so a person types it and presses Apply (adapters/keka.ts, a handoff).
    // Mostly Indian companies, some with offices abroad: only India-eligible jobs are stored.
    source: "keka",
    label: "Keka",
    fetch: fetchKeka,
    stores: indiaEligible,
    formHost: /^[a-z0-9-]+\.keka\.com$/i,
    // The careers subdomain ("Jupiter Money" → the model's guess "jupitermoney"; the real one comes from the crawl).
    slugOf: (text) => {
      const lower = text.trim().toLowerCase();
      const host = lower.match(/^(?:https?:\/\/)?([a-z0-9-]+)\.keka\.com/);
      return host ? host[1] : lower.replace(/[^a-z0-9-]/g, "");
    },
    discovery: {
      boardUrl: "<company>.keka.com/careers",
      async open(slug) {
        // An unknown subdomain has no portal: fetchKeka throws, which is null here.
        return openOrGone(() => fetchKeka(slug));
      },
      // Indian companies with a few openings each, as Zoho: one fresh India job is enough.
      counts: indiaEligible,
      minIndiaJobs: 1,
      needsFresh: true,
      crawlHosts: ["*.keka.com"],
      slugFromUrl: kekaSlugOf,
      async nameOf(slug) {
        const name = await kekaName(slug);
        await pause(PAUSE_MS);
        return name;
      },
    },
  },
  {
    // SmartRecruiters (Phase M, M7; T95): the public Posting API, India postings only (`country=in`), each posting's
    // description read once (fetchers/smartrecruiters.ts). Strong in India: Swiggy, Freshworks, Bosch. Its application
    // form is a multi-step page behind DataDome, so it is applied to in a visible window with a person to take over.
    source: "smartrecruiters",
    label: "SmartRecruiters",
    fetch: (slug, options) => fetchSmartRecruiters(slug, { known: options?.known }),
    stores: indiaEligible,
    formHost: /^jobs.smartrecruiters.com$/i,
    // The identifier as its addresses write it ("Freshworks"); a bare name has its spaces and punctuation taken out.
    slugOf: (text) => {
      try {
        const fromUrl = smartRecruitersSlugOf(new URL(text));
        if (fromUrl) return fromUrl;
      } catch {
        // Not an address.
      }
      return text.trim().replace(/[^A-Za-z0-9_-]/g, "");
    },
    discovery: {
      boardUrl: "jobs.smartrecruiters.com/<Company>",
      async open(slug) {
        // The India list alone; an identifier that is not a company lists nothing, which is not a board.
        const jobs = await openOrGone(() => fetchSmartRecruiters(slug, { details: false }));
        if (jobs && jobs.length === 0) return (await smartRecruitersName(slug)) ? jobs : null;
        return jobs;
      },
      counts: indiaEligible,
      minIndiaJobs: 1,
      needsFresh: true,
      crawlHosts: ["jobs.smartrecruiters.com", "careers.smartrecruiters.com"],
      slugFromUrl: smartRecruitersSlugOf,
      async nameOf(slug) {
        const name = await smartRecruitersName(slug);
        await pause(PAUSE_MS);
        return name;
      },
    },
  },
  {
    // Workable (Phase M, M12): the public widget API, every job with its description in one request a company
    // (fetchers/workable.ts). Indian employers: Apna, Zifo. Its one-page form opens in the worker's browser (10 Nov);
    // Turnstile on Submit decides as Ashby's check does (adapters/workable.ts). Only India-eligible jobs are stored.
    source: "workable",
    label: "Workable",
    fetch: (slug) => fetchWorkable(slug),
    stores: indiaEligible,
    formHost: /^apply\.workable\.com$/i,
    slugOf: (text) => {
      try {
        const fromUrl = workableSlugOf(new URL(text));
        if (fromUrl) return fromUrl;
      } catch {
        // Not an address.
      }
      return text.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    },
    discovery: {
      boardUrl: "apply.workable.com/<slug>",
      async open(slug) {
        // An unknown account answers 404 (null here); one with no openings an empty list. Anything else (Workable's
        // 429 rate limit, 10 Nov: 124 accounts read as "not on board" after ~250 calls in ten minutes) is a failed
        // check, retried later, never "not a board". Workable gets a longer pause than the other boards.
        return openOrGone(() => fetchWorkable(slug), WORKABLE_PAUSE_MS);
      },
      counts: indiaEligible,
      minIndiaJobs: 1,
      needsFresh: true,
      crawlHosts: ["apply.workable.com", "*.workable.com"],
      slugFromUrl: workableSlugOf,
      async nameOf(slug) {
        const name = await workableName(slug);
        await pause(PAUSE_MS);
        return name;
      },
    },
  },
  {
    // Naukri (Phase K, docs/naukri/TDD.md): read per user in the user's own signed-in window (ingest.ts ingestForUser,
    // fetchers/naukri.ts), never per company and never by a crawl. Its company rows are inactive.
    source: "naukri",
    label: "Naukri",
    perUser: true,
    fetch: async () => {
      throw new Error("naukri is read per user, through the user's own account");
    },
    stores: indiaEligible,
    formHost: /^www\.naukri\.com$/i,
    slugOf: (text) => text.trim(),
  },
  {
    // Hirist (K16-K19, docs/hirist/TDD.md): the same shape as Naukri's. Read by the shared signed-out reader, applied on
    // through the user's own account; its company rows are inactive.
    source: "hirist",
    label: "Hirist",
    perUser: true,
    fetch: async () => {
      throw new Error("hirist is read by the shared reader, through the user's own account");
    },
    stores: indiaEligible,
    formHost: /^www\.hirist\.tech$/i,
    slugOf: (text) => text.trim(),
  },
];

/**
 * The boards a Naukri listing may send the user to and still be applied by the agent: the ones with an adapter
 * (modules/apply/pick.ts). A listing leaving for any other site (Workday, Darwinbox, a careers page) is not stored.
 */
const ADAPTER_BOARDS: readonly BoardSource[] = ["greenhouse", "lever", "ashby", "keka"];

/** The board with an adapter whose application forms are on this host, or null. */
export function adapterBoardOfHost(host: string): BoardSource | null {
  return BOARDS.find((board) => ADAPTER_BOARDS.includes(board.source) && board.formHost.test(host))?.source ?? null;
}

/** The board a source names, or undefined (mock, or a board we no longer take). */
export function boardOf(source: string) {
  return BOARDS.find((board) => board.source === source);
}
