import { db } from "@/lib/db";
import { appUrl, sendPush } from "@/lib/push";
import { sourceRules } from "@/modules/governance";
import { adapterBoardOfHost } from "@/modules/jobs/boards";
import { fromSearch, planSearches, searchUrl, withDetail, type NaukriListing } from "@/modules/jobs/fetchers/naukri";
import { classifyTitle, tracksOf } from "@/modules/jobs/functions";
import { storeSiteListings } from "@/modules/jobs/ingest";
import { embedPendingJobs } from "@/modules/jobs/semantic";
import { tagPosting } from "@/modules/jobs/tagging";
import { getConnection, markStopped, recordIngest, runsToday, SITE_INFO, usableConnection, type Site } from "@/modules/sources";
import { openBrowser } from "../browser";
import { onSignedInPage, readJob, readSearch, type PageStop } from "./naukri";

/**
 * One user's run on a signed-in site (Phase K, docs/naukri/TDD.md 4.6): Naukri's own search pages in the user's own
 * visible window, at a person's pace, within the budget in config/rules.json signed_in_sources. Never a crawl: a few
 * searches built from what the user told us, their first pages, and the job pages of new jobs worth showing them.
 * Worker with a screen only.
 */

const PAGE_SIZE = 20;
const INGEST_DAYS = Number(process.env.INGEST_DAYS) || 60;

export type SourceIngestOutcome =
  | { status: "skipped"; reason: "not_connected" | "daily_budget" | "no_rules" | "no_profile" }
  | { status: "ran"; runId: string; stopReason: string; listed: number; created: number; updated: number; details: number };

// A person does not open pages on a timer: the pause varies by up to half again.
const pause = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000 * (1 + Math.random() * 0.5)));

export function worthDetail(job: NaukriListing) {
  if (job.applyKind !== "naukri") return false;
  const { eligibility } = tagPosting(job);
  return (eligibility === "india" || eligibility === "remote_india") && classifyTitle(job.title).function !== "non_tech";
}

export async function runSourceIngest(userId: string, site: Site, options: { log?: (line: string) => void } = {}): Promise<SourceIngestOutcome> {
  const log = options.log ?? ((line: string) => console.log(`source-ingest ${site} …${userId.slice(-6)}: ${line}`));
  const rules = sourceRules(site);
  if (!rules) return { status: "skipped", reason: "no_rules" };
  if (!(await usableConnection(userId, site))) return { status: "skipped", reason: "not_connected" };
  if ((await runsToday(userId, site)) >= rules.runs_per_day) return { status: "skipped", reason: "daily_budget" };
  const profile = await db.profile.findUnique({ where: { userId }, select: { tracks: true, currentTitle: true, city: true, yearsExperience: true, skills: true, experience: true, isTest: true } });
  if (!profile || profile.isTest) return { status: "skipped", reason: "no_profile" };

  const run = await db.sourceRun.create({ data: { userId, site } });
  const counts = { searches: 0, pages: 0, listed: 0, created: 0, updated: 0, details: 0 };
  // Why listings were not stored (observability, docs/naukri/TDD.md 4.11): counts only, never a title or a company.
  let kept = "";
  let stop: PageStop | null = null;
  let budgetHit = false;
  let error: string | null = null;
  const info = SITE_INFO[site];
  // Saved back only at the end, and only while the connection is still there: closing after a Disconnect must not
  // write back the sign-in the user just deleted.
  const session = await openBrowser(info.homeUrl, userId, { site, persist: false });
  const stillConnected = async () => (await getConnection(userId, site))?.status === "connected";
  try {
    await session.page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => undefined);
    if (!onSignedInPage(session.page)) {
      stop = "needs_signin";
      return await finish();
    }

    const searches = planSearches({ tracks: tracksOf(profile), currentTitle: profile.currentTitle, city: profile.city, yearsExperience: profile.yearsExperience }, rules.searches_per_run);
    const found = new Map<string, NaukriListing>();
    for (const search of searches) {
      counts.searches += 1;
      for (let pageNo = 1; pageNo <= rules.pages_per_search; pageNo += 1) {
        if (!(await stillConnected())) return await finish();
        await pause(rules.seconds_between_pages);
        const read = await readSearch(session.page, searchUrl(search, pageNo));
        counts.pages += 1;
        if (!read.ok) {
          if (read.stop === "error") {
            error = read.detail;
            break;
          }
          stop = read.stop;
          log(`stopped: ${read.detail}`);
          return await finish(found);
        }
        const result = fromSearch(read.json, adapterBoardOfHost);
        for (const listing of result.listings) found.set(listing.externalId, listing);
        counts.listed += result.listings.length;
        const more = result.listings.length + result.skipped >= PAGE_SIZE && (result.total == null || pageNo * PAGE_SIZE < result.total);
        if (!more) break;
        if (pageNo === rules.pages_per_search) budgetHit = true;
      }
    }

    // The job page, for new jobs worth showing: the whole description and every place. The rest keep their snippet and
    // are read on a later run.
    const listings = [...found.values()];
    const known = await db.job.findMany({ where: { source: site, externalId: { in: listings.map((job) => job.externalId) } }, select: { externalId: true, raw: true } });
    const detailed = new Set(known.filter((row) => (row.raw as Record<string, unknown> | null)?.detailed === true).map((row) => row.externalId));
    const wanted = listings.filter((job) => !detailed.has(job.externalId) && worthDetail(job));
    if (wanted.length > rules.details_per_run) budgetHit = true;
    for (const job of wanted.slice(0, rules.details_per_run)) {
      if (!(await stillConnected())) return await finish(found);
      await pause(rules.seconds_between_pages);
      const read = await readJob(session.page, job.applyUrl, job.externalId);
      if (!read.ok) {
        if (read.stop === "error") continue;
        stop = read.stop;
        log(`stopped: ${read.detail}`);
        return await finish(found);
      }
      found.set(job.externalId, withDetail(job, read.json));
      counts.details += 1;
    }
    return await finish(found);
  } catch (failure) {
    error = failure instanceof Error ? failure.message.slice(0, 200) : "failed";
    return await finish();
  } finally {
    await session.close();
  }

  // Stores what was read (also when a run stops part way), records the run, and settles the connection.
  async function finish(found?: Map<string, NaukriListing>): Promise<SourceIngestOutcome> {
    const connected = await stillConnected();
    if (found && found.size > 0) {
      const all = [...found.values()];
      const elsewhere = all.filter((job) => job.applyKind === "none").length;
      const onBoard = all.filter((job) => job.applyKind === "board").length;
      const tech = all.filter((job) => job.applyKind === "naukri" && worthDetail(job)).length;
      kept = `; ${found.size} unique: ${all.length - elsewhere - onBoard} apply on Naukri (${tech} India tech), ${onBoard} on a board we apply on, ${elsewhere} elsewhere (not kept)`;
    }
    if (found && found.size > 0 && connected) {
      const stored = await storeSiteListings(site, [...found.values()], Date.now() - INGEST_DAYS * 24 * 60 * 60 * 1000);
      counts.created = stored.created;
      counts.updated = stored.updated;
      if (stored.created + stored.updated > 0) await embedPendingJobs().catch(() => 0);
    }
    const stopReason = !connected && !stop ? "disconnected" : stop ?? (error && counts.listed === 0 ? "error" : budgetHit ? "budget" : "done");
    await db.sourceRun.update({ where: { id: run.id }, data: { ...counts, finishedAt: new Date(), stopReason, error } });
    if (stop && stop !== "error") {
      if (await markStopped(userId, site, stop, rules!.pause_hours_after_challenge)) {
        await sendPush(userId, {
          title: stop === "needs_signin" ? `Sign in to ${info.label} again` : `${info.label} paused your agent`,
          body: stop === "needs_signin" ? `${info.label} signed you out. Sign in again from Account so your agent can keep finding jobs there.` : `${info.label} asked for a check, so your agent stopped using it for a day. Nothing was sent.`,
          url: appUrl("/account"),
          tag: `source-${site}`,
        }).catch(() => 0);
      }
    } else if (connected) {
      // Naukri refreshes its cookies as pages are opened: the refreshed sign-in replaces the saved one.
      await session.saveState();
      await recordIngest(userId, site);
    }
    log(`${stopReason}: ${counts.searches} searches, ${counts.pages} pages, ${counts.listed} listed, ${counts.details} job pages, ${counts.created} new, ${counts.updated} changed${kept}${error ? `; ${error}` : ""}`);
    return { status: "ran", runId: run.id, stopReason, listed: counts.listed, created: counts.created, updated: counts.updated, details: counts.details };
  }
}
