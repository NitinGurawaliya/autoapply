import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { afterIngest, afterIngestDeadline } from "./after-ingest";
import { boardOf } from "./boards";
import { GENTLE_BOARDS, GENTLE_GROUP_TIER, GENTLE_PER_TICK, GENTLE_SCALE, nextFetchAt, REFUSED, tierOf, type Tier } from "./cadence";
import type { NaukriListing } from "./fetchers/naukri";
import { classifyTitle } from "./functions";
import type { BoardHttp, FetchedJob } from "./normalize";
import { forgetJobVectors } from "./semantic";
import { jobSkills } from "./skills";
import { tagPosting } from "./tagging";

// Hundreds of companies (T79): a few boards at a time, a pause between requests, one retry, and only the jobs that
// changed are written. One run at a time: a run that has not finished within RUN_LIMIT_MS is treated as dead.
const CONCURRENCY = 4;
const PAUSE_MS = 300;
const RUN_LIMIT_MS = 2 * 60 * 60 * 1000;
// Run mode (INGEST_MODE=run): a company is switched off after this many failed fetches in a row (8 runs = a day), or
// after this long with no open jobs at all. Its offReason says which; seeding it again turns it on. Tick mode (M2)
// switches nobody off: such a company is `dead` and read once a month (cadence.ts).
const OFF_AFTER_FAILURES = 8;
const OFF_AFTER_EMPTY_DAYS = 30;
/** How far back a posting may be dated and still be stored (INGEST_DAYS, as the scheduled run). */
export const DEFAULT_INGEST_DAYS = 60;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const INDIA = new Set(["india", "remote_india"]);

/**
 * Whether ingest stores this job from this board: India-eligible by default (boards.ts `stores`; Ashby: India tech
 * only). Companies watched before Phase M (`keepAbroad`, Greenhouse and Lever) also keep their jobs abroad (owner, 9 Nov).
 */
export function storedFromBoard(source: string, job: FetchedJob, keepAbroad = false) {
  if (keepAbroad) return true;
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

async function fetchCompany(source: string, slug: string, known?: ReadonlySet<string>, http?: BoardHttp): Promise<FetchedJob[]> {
  return boardOf(source)?.fetch(slug, { known, http }) ?? [];
}

/** What ingest stores and tags from: when none of it changed, the job is not written again. */
/** The pay columns from the board's structured pay (Phase M5); all null when it publishes none. */
function payOf(job: FetchedJob) {
  return { salaryMin: job.salary?.min ?? null, salaryMax: job.salary?.max ?? null, salaryCurrency: job.salary?.currency ?? null, salaryPeriod: job.salary?.period ?? null };
}

export function contentHash(job: FetchedJob) {
  const parts = [job.title, job.location, (job.offices ?? []).join("|"), job.description, job.applyUrl, job.postedAt.toISOString(), job.isRemote ? "remote" : ""];
  return createHash("md5").update(parts.join("\u0000")).digest("hex");
}

export type CompanyResult = {
  fetched: number;
  created: number;
  updated: number;
  closed: number;
  createdEligible: number;
  /** India-eligible jobs the board lists now (stored or not); unknown (null) when the read was skipped or failed. */
  indiaListed: number | null;
  /** The board's list hash when it has a probe (Greenhouse), so the next read can skip an unchanged board. */
  listHash: string | null;
  /** The probe said nothing changed since the last read: nothing else was read or written. */
  unchanged?: boolean;
  error?: string;
};

export type IngestCompany = { id: string; source: string; slug: string; keepAbroad?: boolean; listHash?: string | null };

/** One company: fetch its board (one retry), create new jobs, update changed ones, close the ones it no longer lists. */
export async function ingestCompany(company: IngestCompany, cutoff: number, options: { http?: BoardHttp } = {}): Promise<CompanyResult> {
  const empty = { fetched: 0, created: 0, updated: 0, closed: 0, createdEligible: 0, indiaListed: null, listHash: company.listHash ?? null };
  const board = boardOf(company.source);
  // Boards with a cheap list (Greenhouse): an unchanged list means an unchanged board; a failed probe reads in full.
  let listHash: string | null = null;
  if (board?.probe) {
    listHash = await board.probe(company.slug).catch(() => null);
    if (listHash && company.listHash && listHash === company.listHash) return { ...empty, unchanged: true };
  }
  // Postings already stored for this company: a list-then-detail board (Workday) reads only the new ones in full.
  const knownRows = await db.job.findMany({ where: { companyId: company.id, source: company.source }, select: { externalId: true } });
  const known = new Set(knownRows.map((row) => row.externalId));
  let jobs: FetchedJob[];
  try {
    jobs = await fetchCompany(company.source, company.slug, known, options.http);
  } catch (first) {
    // A refused read (cadence.ts REFUSED) is not tried again at once: asking again is what got it refused.
    const message = first instanceof Error ? first.message : "fetch failed";
    if (REFUSED.test(message)) return { ...empty, listHash: null, error: message };
    await pause(2000);
    try {
      jobs = await fetchCompany(company.source, company.slug, known, options.http);
    } catch (error) {
      return { ...empty, listHash: null, error: error instanceof Error ? error.message : "fetch failed" };
    }
  }
  const indiaListed = jobs.filter((job) => INDIA.has(tagPosting(job).eligibility)).length;
  const kept = jobs.filter((job) => job.postedAt.getTime() >= cutoff && storedFromBoard(company.source, job, company.keepAbroad));
  const written = await storeJobs(company, kept);
  const closed = await markClosed(company.id, company.source, jobs.map((job) => job.externalId));
  return { fetched: jobs.length, ...written, closed, indiaListed, listHash };
}

/**
 * Writes one company's jobs (INGEST_CONTRACT): new ones created, changed ones rewritten (content, company, or back after
 * closing), pay-only changes written alone, unchanged ones left alone. `applyViaOf`: the board that applies to a job when
 * it is not its source's own (a Naukri listing that sends the user to Greenhouse; docs/naukri/TDD.md 4.6).
 */
export async function storeJobs(company: { id: string; source: string }, kept: FetchedJob[], applyViaOf?: (job: FetchedJob) => string | null) {
  const stored = await db.job.findMany({ where: { source: company.source, externalId: { in: kept.map((job) => job.externalId) } }, select: { id: true, externalId: true, contentHash: true, closedAt: true, companyId: true, salaryMin: true, salaryMax: true, salaryCurrency: true, salaryPeriod: true } });
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
      // The tech terms the posting names (Phase M2): the card and job page compare them with the candidate's.
      skills: jobSkills(job.title, job.description),
      ...payOf(job),
      description: job.description,
      applyUrl: job.applyUrl,
      postedAt: job.postedAt,
      fetchedAt: now,
      contentHash: contentHash(job),
      raw: job.raw as Prisma.InputJsonValue,
      ...(applyViaOf ? { applyVia: applyViaOf(job) } : {}),
    };
  };
  // A list-only posting is one we hold already; one we do not (deleted meanwhile) waits for a full read.
  const fresh = kept.filter((job) => !job.listOnly && !byExternalId.has(job.externalId)).map((job) => ({ source: company.source, externalId: job.externalId, ...fields(job) }));
  // A stored job is rewritten only when its content changed, it moved company, or it came back after being closed.
  // A list-only one carries no content: it is only reopened or moved, its stored text kept.
  const changed = kept.filter((job) => {
    const row = byExternalId.get(job.externalId);
    if (!row) return false;
    if (job.listOnly) return row.closedAt !== null || row.companyId !== company.id;
    return row.contentHash !== contentHash(job) || row.closedAt !== null || row.companyId !== company.id;
  });
  if (fresh.length > 0) await db.job.createMany({ data: fresh, skipDuplicates: true });
  for (let i = 0; i < changed.length; i += 50) {
    await db.$transaction(
      changed.slice(i, i + 50).map((job) =>
        db.job.update({
          where: { source_externalId: { source: company.source, externalId: job.externalId } },
          data: job.listOnly ? { companyId: company.id, fetchedAt: now, closedAt: null } : { ...fields(job), closedAt: null },
        }),
      ),
    );
  }
  // Pay moves without the posting changing (Ashby edits its compensation block): only the pay columns are written, so
  // the job keeps its vector and the model's verdicts. A list-only posting carries no pay to compare: its stored pay stays.
  const changedIds = new Set(changed.map((job) => job.externalId));
  const repaid = kept.filter((job) => {
    const row = byExternalId.get(job.externalId);
    if (!row || job.listOnly || changedIds.has(job.externalId)) return false;
    const pay = payOf(job);
    return row.salaryMin !== pay.salaryMin || row.salaryMax !== pay.salaryMax || row.salaryCurrency !== pay.salaryCurrency || row.salaryPeriod !== pay.salaryPeriod;
  });
  for (let i = 0; i < repaid.length; i += 50) {
    await db.$transaction(repaid.slice(i, i + 50).map((job) => db.job.update({ where: { source_externalId: { source: company.source, externalId: job.externalId } }, data: payOf(job) })));
  }
  // A changed posting is embedded again (semantic.ts); new ones have no vector yet. List-only ones keep theirs.
  await forgetJobVectors(changed.filter((job) => !job.listOnly).map((job) => byExternalId.get(job.externalId)!.id));
  return {
    created: fresh.length,
    updated: changed.length,
    createdEligible: fresh.filter((job) => INDIA.has(job.eligibility)).length,
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


type CompanyState = { id: string; source: string; slug: string; listHash: string | null; failedFetches: number; notFoundFetches: number; emptySince: Date | null; lastIndiaAt: Date | null; indiaOpen: number; lastFetchCount: number | null };

const NOT_FOUND = /\b(404|410)\b/;

/**
 * What one read changes on the company: errors in a row, since when it has been empty, its India counts, its tier and
 * when to read it next (cadence.ts). Run mode also switches a company off as before M2; tick mode never does.
 */
export async function recordRead(company: CompanyState, result: CompanyResult, mode: "run" | "tick", now = new Date()) {
  // A refused read (cadence.ts REFUSED) keeps the failures in a row where they were and is not backed off.
  const refused = !!result.error && REFUSED.test(result.error);
  const failures = result.error ? (refused ? company.failedFetches : company.failedFetches + 1) : 0;
  const notFound = result.error && NOT_FOUND.test(result.error) ? company.notFoundFetches + 1 : 0;
  const listed = result.unchanged ? (company.lastFetchCount ?? 0) : result.fetched;
  const emptySince = result.error ? company.emptySince : listed === 0 ? (company.emptySince ?? now) : null;
  const indiaListed = result.error ? 0 : result.unchanged ? company.indiaOpen : (result.indiaListed ?? 0);
  const lastIndiaAt = !result.error && indiaListed > 0 ? now : company.lastIndiaAt;
  // Judged as a failed read (keep it where its last good read put it), whatever the count.
  const tier: Tier = tierOf({ listed: result.error ? 0 : listed, indiaListed, lastIndiaAt, emptySince, failures: refused ? Math.max(failures, 1) : failures, notFound }, now);
  const off =
    mode === "run" && failures >= OFF_AFTER_FAILURES
      ? `fetch failed ${failures} times in a row: ${result.error?.slice(0, 80)}`
      : mode === "run" && emptySince && now.getTime() - emptySince.getTime() > OFF_AFTER_EMPTY_DAYS * 24 * 60 * 60 * 1000
        ? `no open jobs for ${OFF_AFTER_EMPTY_DAYS} days`
        : null;
  await db.company.update({
    where: { id: company.id },
    data: {
      lastFetchedAt: now,
      lastFetchCount: result.error ? 0 : listed,
      lastError: result.error ?? null,
      failedFetches: failures,
      notFoundFetches: notFound,
      emptySince,
      indiaOpen: result.error ? company.indiaOpen : indiaListed,
      lastIndiaAt,
      listHash: result.error ? company.listHash ?? null : result.listHash,
      tier,
      nextFetchAt: nextFetchAt(tier, refused ? 0 : failures, now, Math.random, GENTLE_BOARDS.has(company.source) ? GENTLE_SCALE : 1),
      ...(off ? { active: false, offReason: off } : {}),
    },
  });
  return { tier, off };
}

const COMPANY_STATE = { id: true, source: true, slug: true, name: true, keepAbroad: true, listHash: true, failedFetches: true, notFoundFetches: true, emptySince: true, lastIndiaAt: true, indiaOpen: true, lastFetchCount: true } as const;

export { deleteOldClosedJobs } from "./after-ingest";

/**
 * Pull every active company's board and keep the jobs posted within `days`. Returns the run's counts, or null when
 * another run is still going (one at a time, so a manual run cannot overlap the scheduled one). INGEST_MODE=run.
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
  const companies = await db.company.findMany({ where: { active: true }, orderBy: [{ source: "asc" }, { name: "asc" }], select: COMPANY_STATE });
  const totals = { companies: companies.length, failed: 0, fetched: 0, created: 0, updated: 0, closed: 0, deleted: 0, createdEligible: 0, switchedOff: 0 };
  let next = 0;
  const worker = async () => {
    while (next < companies.length) {
      const company = companies[next++];
      const result = await ingestCompany(company, cutoff);
      const { off } = await recordRead(company, result, "run");
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
      console.log(`${company.source} | ${company.name} | ${result.unchanged ? "unchanged" : `${result.fetched} listed | ${result.created} new | ${result.updated} changed${result.closed ? ` | ${result.closed} closed` : ""}`}`);
      await pause(PAUSE_MS);
    }
  };
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    // Embed, skills labels, job reading, warm and cleanup: the same tail as the tick and the workflow (after-ingest.ts).
    const after = await afterIngest({ deadlineMs: afterIngestDeadline("run"), label: "run" });
    totals.deleted = after.deleted ?? 0;
  } finally {
    const { switchedOff, ...recorded } = totals;
    void switchedOff;
    await db.ingestRun.update({ where: { id: runId }, data: { ...recorded, finishedAt: new Date() } });
  }
  console.log(`ingest done: ${JSON.stringify(totals)}`);
  return totals;
}

// ---- Tick mode (INGEST_MODE=tick, M2): one queue job per company, each read when its tier says (cadence.ts).

/**
 * Active companies due for a read, most overdue first; of a gentle board (cadence.ts) at most GENTLE_PER_TICK a tick,
 * marked with the queue group tier that reads them one at a time. The rest stay due for the next ticks.
 */
export async function dueCompanies(limit: number, now = new Date()) {
  const due = await db.company.findMany({ where: { active: true, nextFetchAt: { lte: now } }, orderBy: { nextFetchAt: "asc" }, take: limit, select: { id: true, source: true } });
  const gentle = new Map<string, number>();
  return due.flatMap((company) => {
    if (!GENTLE_BOARDS.has(company.source)) return [company];
    const sent = (gentle.get(company.source) ?? 0) + 1;
    gentle.set(company.source, sent);
    return sent <= GENTLE_PER_TICK ? [{ ...company, groupTier: GENTLE_GROUP_TIER }] : [];
  });
}

/** An IngestRun row for one tick: the companies it sent; each company's read adds its counts (ingestOne). */
export async function startTickRun(companies: number) {
  const run = await db.ingestRun.create({ data: { id: `tick_${Date.now()}`, companies } });
  return run.id;
}

/** One company's read in tick mode: the same read as a run, recorded with its tier and next read time. */
export async function ingestOne(companyId: string, options: { runId?: string; days?: number; now?: Date; http?: BoardHttp } = {}) {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { ...COMPANY_STATE, active: true } });
  if (!company || !company.active) return null;
  const days = options.days ?? (Number(process.env.INGEST_DAYS) || DEFAULT_INGEST_DAYS);
  const now = options.now ?? new Date();
  const result = await ingestCompany(company, now.getTime() - days * 24 * 60 * 60 * 1000, { http: options.http });
  const { tier } = await recordRead(company, result, "tick", now);
  if (options.runId) {
    await db.$executeRaw`
      UPDATE "IngestRun" SET
        failed = failed + ${result.error ? 1 : 0}, fetched = fetched + ${result.fetched}, created = created + ${result.created},
        updated = updated + ${result.updated}, closed = closed + ${result.closed}, "createdEligible" = "createdEligible" + ${result.createdEligible},
        "finishedAt" = ${new Date()}
      WHERE id = ${options.runId}`;
  }
  return { ...result, tier, company: company.name, source: company.source };
}
