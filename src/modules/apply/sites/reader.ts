import { db } from "@/lib/db";
import { readerRules, type ReaderRules } from "@/modules/governance";
import { adapterBoardOfHost } from "@/modules/jobs/boards";
import { fromSearch, searchUrl, withDetail, type NaukriListing } from "@/modules/jobs/fetchers/naukri";
import { jobAgeFor, matchesCompany } from "@/modules/jobs/fetchers/naukriBuckets";
import { storeSiteListings } from "@/modules/jobs/ingest";
import { embedPendingJobs } from "@/modules/jobs/semantic";
import { claimBuckets, failBucket, finishBucket, finishReaderRun, readerOwner, readerState, releaseBuckets, SITE_INFO, startReaderRun, type ReaderCounts } from "@/modules/sources";
import { openBrowser } from "../browser";
import { worthDetail } from "./ingest";
import { readJob, readSearch, type PageRead } from "./naukri";

/**
 * The shared reader (K14, docs/naukri/TDD.md 13.17): one signed-out Chrome window of ours, through a proxy address of its
 * own (never a user's), reads the search buckets the connected users share, at a person's pace, within the budget in
 * config/rules.json shared_readers, and stores the listings as ordinary Job rows. It loads Naukri's own pages and takes
 * what their own script fetched; it never makes the page's signature, never answers a check (it stops, and stays paused),
 * never signs in and never touches a user's account. Worker with a screen only.
 */

const PAGE_SIZE = 20;
const INGEST_DAYS = Number(process.env.INGEST_DAYS) || 60;
// This many buckets in a row that failed on their own page end the window: something is wrong, not one search.
const FAILED_IN_A_ROW = 3;

export type ReaderWindow = {
  search(url: string): Promise<PageRead>;
  job(url: string, jobId: string): Promise<PageRead>;
  close(): Promise<void>;
};

export type ReaderDeps = {
  open(site: string, owner: string): Promise<ReaderWindow>;
  pause(seconds: number): Promise<void>;
  now(): Date;
  log(line: string): void;
  /** Embeds the jobs just stored (semantic.ts); injectable so a check does not call the embedding service. */
  embed(): Promise<unknown>;
};

export type ReaderOutcome =
  | { status: "skipped"; reason: "no_rules" | "paused" | "daily_budget" | "nothing_due" }
  | ({ status: "ran"; runId: string; stopReason: string } & ReaderCounts);

// A person does not open pages on a timer: the pause varies by up to half again.
const sleep = (seconds: number) => new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000 * (1 + Math.random() * 0.5)));

async function openWindow(site: string, owner: string): Promise<ReaderWindow> {
  // Signed out and nothing kept: `fresh` loads no saved sign-in, `persist: false` saves none.
  // The site's public front page, as a visitor opens it: not its signed-in home (SITE_INFO homeUrl), which sends a signed-out visitor to the login.
  const front = `${new URL((SITE_INFO as Record<string, { homeUrl: string }>)[site].homeUrl).origin}/`;
  const session = await openBrowser(front, owner, { site: site as "naukri", fresh: true, persist: false });
  await session.page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => undefined);
  return { search: (url) => readSearch(session.page, url), job: (url, jobId) => readJob(session.page, url, jobId), close: () => session.close() };
}

const defaultDeps: ReaderDeps = { open: openWindow, pause: sleep, now: () => new Date(), log: (line) => console.log(`reader: ${line}`), embed: embedPendingJobs };

type Stop = "challenge" | "refused" | "budget";

async function storedIds(site: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, boolean>();
  const rows = await db.job.findMany({ where: { source: site, externalId: { in: ids } }, select: { externalId: true, raw: true } });
  return new Map(rows.map((row) => [row.externalId, (row.raw as Record<string, unknown> | null)?.detailed === true]));
}

/** One bucket: its first pages (further ones only while they still bring jobs we do not have), the job pages of new jobs worth showing, stored. */
async function readBucket(
  site: string,
  bucket: { kind: string; keyword: string; location: string | null; experience: number | null; lastReadAt: Date | null },
  window: ReaderWindow,
  rules: ReaderRules,
  used: { pages: number; details: number },
  counts: ReaderCounts,
  deps: ReaderDeps,
): Promise<{ stop: Stop | null; failed: string | null; listed: number; unmatched: boolean }> {
  const company = bucket.kind === "company";
  const found = new Map<string, NaukriListing>();
  let stop: Stop | null = null;
  let failed: string | null = null;
  let listed = 0;
  const jobAge = jobAgeFor(bucket.lastReadAt, deps.now(), company ? "company" : "search");
  for (let pageNo = 1; pageNo <= rules.pages_per_bucket; pageNo += 1) {
    if (used.pages + counts.pages >= rules.max_pages_per_day) {
      stop = "budget";
      break;
    }
    await deps.pause(rules.seconds_between_pages);
    const read = await window.search(searchUrl({ keyword: bucket.keyword, location: bucket.location, experience: bucket.experience }, pageNo, jobAge));
    counts.pages += 1;
    if (!read.ok) {
      // Naukri sending a signed-out page to its login is a refusal for this reader, like Access Denied.
      // A search that finds nothing gets a client error from Naukri (27 Nov: "machine learning engineer" in remote, 1 year,
      // last 7 days answered 400): an empty search, not a failed one, so the bucket waits its cadence.
      if (read.stop === "error" && /answered (400|404)\b/.test(read.detail)) {
        deps.log(`${read.detail}: read as an empty search`);
        break;
      }
      if (read.stop === "error") failed = read.detail;
      else stop = read.stop === "challenge" ? "challenge" : "refused";
      deps.log(`${read.stop}: ${read.detail}`);
      break;
    }
    const result = fromSearch(read.json, adapterBoardOfHost);
    // A company's bucket keeps only that company's listings: Naukri's search by a name also returns other companies' jobs.
    const kept = company ? result.listings.filter((listing) => matchesCompany(bucket.keyword, listing.company.name)) : result.listings;
    listed += kept.length;
    for (const listing of kept) found.set(listing.externalId, listing);
    const known = await storedIds(site, kept.map((listing) => listing.externalId));
    const fresh = kept.filter((listing) => !known.has(listing.externalId)).length;
    // A later page only while the whole page was the company's own.
    const more = result.listings.length + result.skipped >= PAGE_SIZE && (result.total == null || pageNo * PAGE_SIZE < result.total) && (!company || kept.length === result.listings.length);
    if (!more || fresh === 0) break;
  }

  // The job page, for new jobs worth showing: the whole description and every place. The rest keep their snippet.
  if (!stop && found.size > 0) {
    const known = await storedIds(site, [...found.keys()]);
    const wanted = [...found.values()].filter((job) => known.get(job.externalId) !== true && worthDetail(job));
    for (const job of wanted.slice(0, rules.details_per_bucket)) {
      if (used.details + counts.details >= rules.max_details_per_day) break;
      await deps.pause(rules.seconds_between_pages);
      const read = await window.job(job.applyUrl, job.externalId);
      if (!read.ok) {
        if (read.stop === "error") continue;
        stop = read.stop === "challenge" ? "challenge" : "refused";
        deps.log(`${read.stop}: ${read.detail}`);
        break;
      }
      found.set(job.externalId, withDetail(job, read.json));
      counts.details += 1;
    }
  }

  // Stored also when the window stopped part way: what was read is real.
  if (found.size > 0) {
    const stored = await storeSiteListings(site, [...found.values()], deps.now().getTime() - INGEST_DAYS * 24 * 60 * 60 * 1000);
    counts.created += stored.created;
    counts.updated += stored.updated;
  }
  counts.listed += listed;
  return { stop, failed, listed, unmatched: company && !stop && !failed && found.size === 0 };
}

/**
 * One window of the shared reader: takes the buckets that are due, reads them one after another, records the run. A
 * check or a refusal ends it and pauses the reader (config pause_hours_after_challenge); its next window uses a new
 * proxy address. Rules, the browser and the clock are injectable so the offline check runs without any of them.
 */
export async function runReader(site: string, options: { reader?: number; rules?: ReaderRules; deps?: Partial<ReaderDeps> } = {}): Promise<ReaderOutcome> {
  const deps: ReaderDeps = { ...defaultDeps, ...options.deps };
  const rules = options.rules ?? readerRules(site);
  if (!rules) return { status: "skipped", reason: "no_rules" };
  const now = deps.now();
  const state = await readerState(site, rules, now);
  if (state.pausedUntil) return { status: "skipped", reason: "paused" };
  if (state.pagesToday >= rules.max_pages_per_day) return { status: "skipped", reason: "daily_budget" };
  const buckets = await claimBuckets(site, rules.buckets_per_run, 30, now);
  if (buckets.length === 0) return { status: "skipped", reason: "nothing_due" };

  const owner = readerOwner(options.reader ?? 1, state.rotation);
  const run = await startReaderRun(site, owner);
  const counts: ReaderCounts = { buckets: 0, pages: 0, listed: 0, created: 0, updated: 0, details: 0 };
  const unread = new Set(buckets.map((bucket) => bucket.id));
  let stop: Stop | null = null;
  let error: string | null = null;
  let failedInARow = 0;
  let window: ReaderWindow | null = null;
  try {
    window = await deps.open(site, owner);
    for (const bucket of buckets) {
      const outcome = await readBucket(site, bucket, window, rules, { pages: state.pagesToday, details: state.detailsToday }, counts, deps);
      counts.buckets += 1;
      if (outcome.stop) {
        stop = outcome.stop;
        break;
      }
      unread.delete(bucket.id);
      if (outcome.failed) {
        error = outcome.failed;
        failedInARow += 1;
        await failBucket(bucket, deps.now());
        if (failedInARow >= FAILED_IN_A_ROW) break;
      } else {
        failedInARow = 0;
        // A company name Naukri has no jobs for is tried again only after a while (rules company_no_match_days).
        if (outcome.unmatched) await finishBucket(bucket, 0, deps.now(), { stop: "no_match", hours: rules.company_no_match_days * 24 });
        else await finishBucket(bucket, outcome.listed, deps.now());
      }
    }
  } catch (failure) {
    error = failure instanceof Error ? failure.message.slice(0, 200) : "failed";
  } finally {
    await window?.close().catch(() => undefined);
    // Not read: due as they were (a check says nothing about the bucket), the claim given back.
    await releaseBuckets([...unread], stop === "challenge" || stop === "refused" ? stop : null);
  }
  if (counts.created + counts.updated > 0) await deps.embed().catch(() => 0);
  const stopReason = stop ?? (error && counts.listed === 0 ? "error" : "done");
  await finishReaderRun(run.id, counts, stopReason, error);
  deps.log(`${stopReason}: ${counts.buckets} buckets, ${counts.pages} pages, ${counts.listed} listed, ${counts.details} job pages, ${counts.created} new, ${counts.updated} changed${error ? `; ${error}` : ""}`);
  return { status: "ran", runId: run.id, stopReason, ...counts };
}
