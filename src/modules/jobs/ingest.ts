import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fetchAshby } from "./fetchers/ashby";
import { fetchGreenhouse } from "./fetchers/greenhouse";
import { fetchLever } from "./fetchers/lever";
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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  if (source === "greenhouse") return fetchGreenhouse(slug);
  if (source === "lever") return fetchLever(slug);
  if (source === "ashby") return fetchAshby(slug);
  return [];
}

/** What ingest stores and tags from: when none of it changed, the job is not written again. */
export function contentHash(job: FetchedJob) {
  const parts = [job.title, job.location, (job.offices ?? []).join("|"), job.description, job.applyUrl, job.postedAt.toISOString(), job.isRemote ? "remote" : ""];
  return createHash("md5").update(parts.join("\u0000")).digest("hex");
}

type CompanyResult = { fetched: number; created: number; updated: number; closed: number; createdEligible: number; error?: string };

/** One company: fetch its board (one retry), create new jobs, update changed ones, close the ones it no longer lists. */
async function ingestCompany(company: { id: string; source: string; slug: string }, cutoff: number): Promise<CompanyResult> {
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
  const kept = jobs.filter((job) => job.postedAt.getTime() >= cutoff);
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
  const closed = await markClosed(company.id, company.source, jobs.map((job) => job.externalId));
  return {
    fetched: jobs.length,
    created: fresh.length,
    updated: changed.length,
    closed,
    createdEligible: fresh.filter((job) => job.eligibility === "india" || job.eligibility === "remote_india").length,
  };
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
  const companies = await db.company.findMany({ where: { active: true }, orderBy: [{ source: "asc" }, { name: "asc" }], select: { id: true, source: true, slug: true, name: true } });
  const totals = { companies: companies.length, failed: 0, fetched: 0, created: 0, updated: 0, closed: 0, deleted: 0, createdEligible: 0 };
  let next = 0;
  const worker = async () => {
    while (next < companies.length) {
      const company = companies[next++];
      const result = await ingestCompany(company, cutoff);
      await db.company.update({ where: { id: company.id }, data: { lastFetchedAt: new Date(), lastFetchCount: result.error ? 0 : result.fetched, lastError: result.error ?? null } });
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
    await db.ingestRun.update({ where: { id: runId }, data: { ...totals, finishedAt: new Date() } });
  }
  console.log(`ingest done: ${JSON.stringify(totals)}`);
  return totals;
}
