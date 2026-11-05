import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { boardOf } from "./boards";
import type { NaukriListing } from "./fetchers/naukri";
import { classifyTitle } from "./functions";
import type { FetchedJob } from "./normalize";
import { embedPendingJobs, forgetJobVectors } from "./semantic";
import { tagPosting } from "./tagging";

// Hundreds of companies (T79): a few boards at a time, a pause between requests, one retry, and only the jobs that
// changed are written. One run at a time: a run that has not finished within RUN_LIMIT_MS is treated as dead.
const CONCURRENCY = 4;
const PAUSE_MS = 300;
const RUN_LIMIT_MS = 2 * 60 * 60 * 1000;
// Closed jobs nobody swiped or applied to are deleted this long after they closed.
const DELETE_CLOSED_AFTER_DAYS = 30;
// A company is switched off after this many failed fetches in a row (8 runs = a day), or after this long with no open
// jobs at all (a board left empty, or moved to another ATS). Its offReason says which; seeding it again turns it on.
const OFF_AFTER_FAILURES = 8;
const OFF_AFTER_EMPTY_DAYS = 30;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether ingest stores this job from this board (boards.ts `stores`: Ashby keeps only India tech jobs). */
export function storedFromBoard(source: string, job: FetchedJob) {
  return boardOf(source)?.stores(job) ?? true;
}

/**
 * Jobs the company's board no longer lists are closed, so the feed stops offering them. Called only after a fetch that
 * worked and returned something: an empty or failed response says nothing about whether jobs were taken down.
 */
export async function markClosed(companyId: string, source: string, listedExternalIds: string[]) {
  if (listedExternalIds.length === 0) return 0;
  const result = await db.job.updateMany({
    where: { companyId, source, closedAt: null, externalId: { notIn: listedExternalIds } },
    data: { closedAt: new Date() },
  });
  return result.count;
}

async function fetchCompany(source: string, slug: string): Promise<FetchedJob[]> {
  return boardOf(source)?.fetch(slug) ?? [];
}

/** What ingest stores and tags from: when none of it changed, the job is not written again. */
export function contentHash(job: FetchedJob) {
  const parts = [job.title, job.location, (job.offices ?? []).join("|"), job.description, job.applyUrl, job.postedAt.toISOString(), job.isRemote ? "remote" : ""];
  return createHash("md5").update(parts.join("\u0000")).digest("hex");
}

type CompanyResult = { fetched: number; created: number; updated: number; closed: number; createdEligible: number; error?: string };

/** One company: fetch its board (one retry), create new jobs, update changed ones, close the ones it no longer lists. */
export async function ingestCompany(company: { id: string; source: string; slug: string }, cutoff: number): Promise<CompanyResult> {
  let jobs: FetchedJob[];
  try {
    jobs = await fetchCompany(company.source, company.slug);
  } catch {
    await pause(2000);
    try {
      jobs = await fetchCompany(company.source, company.slug);
    } catch (error) {
      return { fetched: 0, created: 0, updated: 0, closed: 0, createdEligible: 0, error: error instanceof Error ? error.message : "fetch failed" };
    }
  }
  const kept = jobs.filter((job) => job.postedAt.getTime() >= cutoff && storedFromBoard(company.source, job));
  const written = await storeJobs(company, kept);
  const closed = await markClosed(company.id, company.source, jobs.map((job) => job.externalId));
  return { fetched: jobs.length, ...written, closed };
}

/**
 * Writes one company's jobs (INGEST_CONTRACT): new ones created, changed ones rewritten (content, company, or back after
 * closing), unchanged ones left alone. `applyViaOf`: the board that applies to a job when it is not its source's own
 * (a Naukri listing that sends the user to Greenhouse; docs/naukri/TDD.md 4.6).
 */
export async function storeJobs(company: { id: string; source: string }, kept: FetchedJob[], applyViaOf?: (job: FetchedJob) => string | null) {
  const stored = await db.job.findMany({ where: { source: company.source, externalId: { in: kept.map((job) => job.externalId) } }, select: { id: true, externalId: true, contentHash: true, closedAt: true, companyId: true } });
  const byExternalId = new Map(stored.map((row) => [row.externalId, row]));
  const now = new Date();
  const fields = (job: FetchedJob) => {
    const tags = tagPosting(job);
    const kind = classifyTitle(job.title);
    return {
      companyId: company.id,
      title: job.title,
      location: job.location,
      country: tags.country,
      remoteType: tags.remoteType,
      experienceMin: tags.experienceMin,
      eligibility: tags.eligibility,
      function: kind.function,
      track: kind.track,
      seniority: kind.seniority,
      description: job.description,
      applyUrl: job.applyUrl,
      postedAt: job.postedAt,
      fetchedAt: now,
      contentHash: contentHash(job),
      raw: job.raw as Prisma.InputJsonValue,
      ...(applyViaOf ? { applyVia: applyViaOf(job) } : {}),
    };
  };
  const fresh = kept.filter((job) => !byExternalId.has(job.externalId)).map((job) => ({ source: company.source, externalId: job.externalId, ...fields(job) }));
  // A stored job is rewritten only when its content changed, it moved company, or it came back after being closed.
  const changed = kept.filter((job) => {
    const row = byExternalId.get(job.externalId);
    return row && (row.contentHash !== contentHash(job) || row.closedAt !== null || row.companyId !== company.id);
  });
  if (fresh.length > 0) await db.job.createMany({ data: fresh, skipDuplicates: true });
  for (let i = 0; i < changed.length; i += 50) {
    await db.$transaction(
      changed.slice(i, i + 50).map((job) => db.job.update({ where: { source_externalId: { source: company.source, externalId: job.externalId } }, data: { ...fields(job), closedAt: null } })),
    );
  }
  // A changed posting is embedded again (semantic.ts); new ones have no vector yet.
  await forgetJobVectors(changed.map((job) => byExternalId.get(job.externalId)!.id));
  return {
    created: fresh.length,
    updated: changed.length,
    createdEligible: fresh.filter((job) => job.eligibility === "india" || job.eligibility === "remote_india").length,
  };
}

// A signed-in site's job (Naukri) that no user's search has listed for this long is closed: a search is not the
// company's board, so its absence from one run says nothing (docs/naukri/TDD.md 4.6). A later run that lists it reopens it.
const SITE_UNSEEN_CLOSE_DAYS = 14;

export type SiteStoreResult = { kept: number; created: number; updated: number; createdEligible: number; closed: number; companies: number };

/**
 * Stores what one user's run on a signed-in site found (Phase K): ordinary Job rows shared by every connected user,
 * under inactive Company rows (the company ingest never fetches them). Listings Naukri sends to a site we cannot apply
 * on never reach here (fetchers/naukri.ts applyKind "none").
 */
export async function storeSiteListings(site: string, listings: NaukriListing[], cutoff: number, now = new Date()): Promise<SiteStoreResult> {
  const kept = listings.filter((job) => job.applyKind !== "none" && job.postedAt.getTime() >= cutoff && storedFromBoard(site, job));
  const byCompany = new Map<string, NaukriListing[]>();
  for (const job of kept) byCompany.set(job.company.slug, [...(byCompany.get(job.company.slug) ?? []), job]);
  const applyVia = new Map(kept.map((job) => [job.externalId, job.applyVia]));
  const totals: SiteStoreResult = { kept: kept.length, created: 0, updated: 0, createdEligible: 0, closed: 0, companies: byCompany.size };
  for (const [slug, jobs] of byCompany) {
    const first = jobs[0].company;
    const company = await db.company.upsert({
      where: { source_slug: { source: site, slug } },
      create: { source: site, slug, name: first.name, active: false, addedBy: site, logoUrl: first.logoUrl, logoCheckedAt: first.logoUrl ? now : null },
      update: first.logoUrl ? { logoUrl: first.logoUrl, logoCheckedAt: now } : {},
      select: { id: true },
    });
    const written = await storeJobs({ id: company.id, source: site }, jobs, (job) => applyVia.get(job.externalId) ?? null);
    totals.created += written.created;
    totals.updated += written.updated;
    totals.createdEligible += written.createdEligible;
  }
  // Seen now, so the unseen sweep below keys on it (unchanged jobs are not rewritten by storeJobs).
  if (kept.length > 0) await db.job.updateMany({ where: { source: site, externalId: { in: kept.map((job) => job.externalId) } }, data: { fetchedAt: now } });
  const unseenSince = new Date(now.getTime() - SITE_UNSEEN_CLOSE_DAYS * 24 * 60 * 60 * 1000);
  const closed = await db.job.updateMany({ where: { source: site, closedAt: null, fetchedAt: { lt: unseenSince } }, data: { closedAt: now } });
  totals.closed = closed.count;
  return totals;
}

/** Closed jobs nobody swiped or applied to, closed more than DELETE_CLOSED_AFTER_DAYS ago: deleted to keep the table small. */
export async function deleteOldClosedJobs(now = new Date()) {
  const before = new Date(now.getTime() - DELETE_CLOSED_AFTER_DAYS * 24 * 60 * 60 * 1000);
  return db.$executeRaw`
    DELETE FROM "Job" j
    WHERE j."closedAt" IS NOT NULL AND j."closedAt" < ${before}
      AND NOT EXISTS (SELECT 1 FROM "Swipe" s WHERE s."jobId" = j.id)
      AND NOT EXISTS (SELECT 1 FROM "Application" a WHERE a."jobId" = j.id)`;
}

/**
 * Pull every active company's board and keep the jobs posted within `days`. Returns the run's counts, or null when
 * another run is still going (one at a time, so a manual run cannot overlap the scheduled one).
 */
export async function ingestJobs(days: number) {
  const staleBefore = new Date(Date.now() - RUN_LIMIT_MS);
  const started = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "IngestRun" ("id")
    SELECT ${`run_${Date.now()}`}
    WHERE NOT EXISTS (SELECT 1 FROM "IngestRun" WHERE "finishedAt" IS NULL AND "startedAt" > ${staleBefore})
    RETURNING "id"`;
  const runId = started[0]?.id;
  if (!runId) {
    console.log("ingest: another run is still going; skipped");
    return null;
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const companies = await db.company.findMany({ where: { active: true }, orderBy: [{ source: "asc" }, { name: "asc" }], select: { id: true, source: true, slug: true, name: true, failedFetches: true, emptySince: true } });
  const totals = { companies: companies.length, failed: 0, fetched: 0, created: 0, updated: 0, closed: 0, deleted: 0, createdEligible: 0, switchedOff: 0 };
  let next = 0;
  const worker = async () => {
    while (next < companies.length) {
      const company = companies[next++];
      const result = await ingestCompany(company, cutoff);
      const now = new Date();
      const failures = result.error ? company.failedFetches + 1 : 0;
      const emptySince = result.error ? company.emptySince : result.fetched === 0 ? company.emptySince ?? now : null;
      const off =
        failures >= OFF_AFTER_FAILURES
          ? `fetch failed ${failures} times in a row: ${result.error?.slice(0, 80)}`
          : emptySince && now.getTime() - emptySince.getTime() > OFF_AFTER_EMPTY_DAYS * 24 * 60 * 60 * 1000
            ? `no open jobs for ${OFF_AFTER_EMPTY_DAYS} days`
            : null;
      await db.company.update({
        where: { id: company.id },
        data: { lastFetchedAt: now, lastFetchCount: result.error ? 0 : result.fetched, lastError: result.error ?? null, failedFetches: failures, emptySince, ...(off ? { active: false, offReason: off } : {}) },
      });
      if (off) {
        totals.switchedOff += 1;
        console.log(`ingest: switched off ${company.source} ${company.slug}: ${off}`);
      }
      if (result.error) {
        totals.failed += 1;
        console.error(`ingest error ${company.source} ${company.slug}: ${result.error}`);
      }
      totals.fetched += result.fetched;
      totals.created += result.created;
      totals.updated += result.updated;
      totals.closed += result.closed;
      totals.createdEligible += result.createdEligible;
      console.log(`${company.source} | ${company.name} | ${result.fetched} listed | ${result.created} new | ${result.updated} changed${result.closed ? ` | ${result.closed} closed` : ""}`);
      await pause(PAUSE_MS);
    }
  };
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    totals.deleted = await deleteOldClosedJobs();
    // New and changed jobs get their vectors for resume matching; a failure leaves them for the next run.
    const embedded = await embedPendingJobs().catch((error) => {
      console.error(`ingest: embedding failed (${error instanceof Error ? error.message.slice(0, 80) : "error"}); the next run retries`);
      return 0;
    });
    console.log(`ingest: embedded ${embedded} jobs`);
  } finally {
    const { switchedOff, ...recorded } = totals;
    void switchedOff;
    await db.ingestRun.update({ where: { id: runId }, data: { ...recorded, finishedAt: new Date() } });
  }
  console.log(`ingest done: ${JSON.stringify(totals)}`);
  return totals;
}
