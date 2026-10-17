import { fetchAshby } from "./fetchers/ashby";
import { fetchGreenhouse } from "./fetchers/greenhouse";
import { fetchLever } from "./fetchers/lever";
import { classifyTitle } from "./functions";
import type { FetchedJob } from "./normalize";
import { tagPosting } from "./tagging";

/**
 * Every public job board we take jobs from, in one place (T91): how its jobs are fetched, which jobs are stored, the
 * hosts its application forms may open on, and how discovery finds new companies on it. Adding a board is one entry
 * here plus a fetcher and an adapter (docs/INGEST_CONTRACT.md).
 */

export type BoardSource = "greenhouse" | "lever" | "ashby";

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
  /** Board names also come from the Common Crawl index of the board's host (discovery.ts slugsFromCrawl). */
  crawlHost?: string;
  /** The company's own name for a board known only by its slug (from the crawl), or null. */
  nameOf?: (slug: string) => Promise<string | null>;
};

export type Board = {
  source: BoardSource;
  label: string;
  /** Every open job on the company's board. */
  fetch: (slug: string) => Promise<FetchedJob[]>;
  /** Which fetched jobs ingest stores; the rest are dropped. */
  stores: (job: FetchedJob) => boolean;
  /** The hosts this board's application forms are on: the worker opens nothing else for its jobs (apply/urls.ts). */
  formHost: RegExp;
  /** How a company name or slug is written as this board's slug. */
  slugOf: (text: string) => string;
  discovery?: BoardDiscovery;
};

// Discovery is polite: a pause after every request it makes to a board.
const PAUSE_MS = 300;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const storeAll = () => true;

export const BOARDS: Board[] = [
  {
    source: "greenhouse",
    label: "Greenhouse",
    fetch: fetchGreenhouse,
    stores: storeAll,
    formHost: /^(job-boards|boards)(\.eu)?\.greenhouse\.io$/i,
    slugOf: (text) => text.toLowerCase().replace(/[^a-z0-9]/g, ""),
    discovery: {
      boardUrl: "boards.greenhouse.io/<slug>",
      async open(slug) {
        const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
        await pause(PAUSE_MS);
        return response?.ok ? fetchGreenhouse(slug) : null;
      },
      counts: indiaEligible,
      minIndiaJobs: MIN_INDIA_JOBS,
      needsFresh: true,
    },
  },
  {
    source: "lever",
    label: "Lever",
    fetch: fetchLever,
    stores: storeAll,
    formHost: /^jobs(\.eu)?\.lever\.co$/i,
    slugOf: (text) => text.toLowerCase().replace(/[^a-z0-9.-]/g, ""),
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
        const jobs = await fetchAshby(slug).catch(() => null);
        await pause(PAUSE_MS);
        return jobs;
      },
      // Ashby: one India tech job is enough, the jobs ingest stores from Ashby (owner, 15 Oct: as many companies as
      // possible). Few Ashby companies hire in India, so the Greenhouse bar would add almost none.
      counts: indiaTech,
      minIndiaJobs: 1,
      needsFresh: false,
      crawlHost: "jobs.ashbyhq.com",
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
];

/** The board a source names, or undefined (mock, or a board we no longer take). */
export function boardOf(source: string) {
  return BOARDS.find((board) => board.source === source);
}
