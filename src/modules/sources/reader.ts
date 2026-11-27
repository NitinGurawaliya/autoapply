import { Prisma, type ReaderBucket } from "@prisma/client";
import { db } from "@/lib/db";
import { siteOn, sitesOn } from "@/lib/site-flags";
import type { ReaderRules } from "@/modules/governance";
import { tracksOf } from "@/modules/jobs/functions";
import { companyBucket, everyHours, planBuckets, type BucketInput } from "@/modules/jobs/fetchers/naukriBuckets";
import { plannerOf } from "@/modules/jobs/fetchers/siteSearches";

/**
 * The shared reader's bookkeeping (K14, docs/naukri/TDD.md 13.17): which search buckets exist, which are due, what each
 * reader window did. Rows only: nothing about a user is kept (a bucket holds how many users it serves, never which).
 * The window itself is modules/apply/sites/reader.ts.
 */

/**
 * <SITE>_READER=1 (NAUKRI_READER, HIRIST_READER): this process works the site's shared reader, and a user's own account no
 * longer reads on a timer. Without a site: any site's.
 */
export function sharedReaderOn(site?: string, env: Record<string, string | undefined> = process.env) {
  return site ? siteOn(site, "reader", env) : sitesOn("reader", env).length > 0;
}

const CONNECTED = ["connected", "limited"];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Plans the buckets from the profiles of the users connected to the site (only they see its jobs, so only their
 * searches are read), and keeps the rows in step: new buckets are due at once, a bucket no user wants any more is
 * switched off, a changed count moves its cadence. Run by the plan tick.
 */
export async function planReaderBuckets(site: string, rules: ReaderRules, now = new Date(), only?: { userIds: string[] }) {
  const connections = await db.siteConnection.findMany({ where: { site, status: { in: CONNECTED }, ...(only ? { userId: { in: only.userIds } } : {}) }, select: { userId: true } });
  const profiles = await db.profile.findMany({
    where: { userId: { in: connections.map((row) => row.userId) }, isTest: false },
    select: { tracks: true, currentTitle: true, city: true, yearsExperience: true, skills: true, experience: true },
  });
  const inputs: BucketInput[] = profiles.map((profile) => ({ tracks: tracksOf(profile), currentTitle: profile.currentTitle, city: profile.city, yearsExperience: profile.yearsExperience }));
  const planned = planBuckets(inputs, { perUser: rules.buckets_per_user, max: rules.max_buckets, plan: plannerOf(site) });
  // Only the searches users want: a company's bucket comes from a list (seedCompanyBuckets) and is never retired here.
  const existing = new Set((await db.readerBucket.findMany({ where: { site, kind: "search" }, select: { key: true } })).map((row) => row.key));
  let added = 0;
  for (const bucket of planned) {
    const hours = everyHours(bucket.users, rules.every_hours);
    if (existing.has(bucket.key)) {
      await db.readerBucket.update({ where: { site_key: { site, key: bucket.key } }, data: { users: bucket.users, everyHours: hours, active: true } });
    } else {
      await db.readerBucket.create({ data: { site, key: bucket.key, kind: "search", keyword: bucket.keyword, location: bucket.location, experience: bucket.experience, users: bucket.users, everyHours: hours, nextReadAt: now } });
      added += 1;
    }
  }
  const wanted = planned.map((bucket) => bucket.key);
  const retired = await db.readerBucket.updateMany({ where: { site, kind: "search", active: true, key: { notIn: wanted } }, data: { active: false, users: 0 } });
  return { users: inputs.length, buckets: planned.length, added, retired: retired.count };
}

/**
 * The companies of a list as buckets (K14, company buckets): each searched by its name, no place, no years, read every
 * `hours`, after the searches users want (they carry users, these carry none). New names are due at once; a known one is
 * left as it is. Names only: nothing else of the list is kept.
 */
export async function seedCompanyBuckets(site: string, names: string[], hours: number, now = new Date()) {
  const buckets = new Map<string, NonNullable<ReturnType<typeof companyBucket>>>();
  for (const name of names) {
    const bucket = companyBucket(name);
    if (bucket && !buckets.has(bucket.key)) buckets.set(bucket.key, bucket);
  }
  const known = new Set((await db.readerBucket.findMany({ where: { site, kind: "company" }, select: { key: true } })).map((row) => row.key));
  const fresh = [...buckets.values()].filter((bucket) => !known.has(bucket.key));
  if (fresh.length > 0) {
    await db.readerBucket.createMany({ data: fresh.map((bucket) => ({ site, key: bucket.key, kind: "company", keyword: bucket.keyword, users: 0, everyHours: hours, nextReadAt: now })), skipDuplicates: true });
  }
  return { names: names.length, buckets: buckets.size, added: fresh.length, known: buckets.size - fresh.length };
}

/** How many buckets are due now (the plan tick queues a window only when there is something to read). */
export function dueBuckets(site: string, now = new Date()) {
  return db.readerBucket.count({ where: { site, active: true, nextReadAt: { lte: now }, OR: [{ claimedUntil: null }, { claimedUntil: { lt: now } }] } });
}

/**
 * Takes up to `limit` due buckets for one window, the most wanted first, atomically: two readers never hold the same
 * bucket (SKIP LOCKED), and a window that dies leaves its claim to lapse after `minutes`.
 */
export async function claimBuckets(site: string, limit: number, minutes = 30, now = new Date()): Promise<ReaderBucket[]> {
  const until = new Date(now.getTime() + minutes * MINUTE);
  return db.$queryRaw<ReaderBucket[]>(Prisma.sql`
    UPDATE "ReaderBucket" SET "claimedUntil" = ${until}
    WHERE id IN (
      SELECT id FROM "ReaderBucket"
      WHERE site = ${site} AND active AND "nextReadAt" <= ${now} AND ("claimedUntil" IS NULL OR "claimedUntil" < ${now})
      ORDER BY users DESC, "nextReadAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`);
}

/** The bucket was read: due again after its cadence (a little uneven, like a person's), the claim given back. */
export async function finishBucket(bucket: Pick<ReaderBucket, "id" | "everyHours">, listed: number, now = new Date(), options: { stop?: string; hours?: number } = {}) {
  const jitter = 0.9 + Math.random() * 0.2;
  await db.readerBucket.update({
    where: { id: bucket.id },
    data: { lastReadAt: now, nextReadAt: new Date(now.getTime() + (options.hours ?? bucket.everyHours) * HOUR * jitter), claimedUntil: null, lastStop: options.stop ?? "done", lastListed: listed, failures: 0 },
  });
}

/** A read of the bucket failed on its own page: tried again soon, later each time, never past its cadence. */
export async function failBucket(bucket: Pick<ReaderBucket, "id" | "everyHours" | "failures">, now = new Date()) {
  const failures = bucket.failures + 1;
  const wait = Math.min(bucket.everyHours, failures) * HOUR;
  await db.readerBucket.update({ where: { id: bucket.id }, data: { failures, lastStop: "error", nextReadAt: new Date(now.getTime() + wait), claimedUntil: null } });
}

/** The window stopped (a check, a refusal, the day's budget): these buckets were not read, and stay due as they were. */
export async function releaseBuckets(ids: string[], stop: string | null) {
  if (ids.length === 0) return;
  await db.readerBucket.updateMany({ where: { id: { in: ids } }, data: { claimedUntil: null, ...(stop ? { lastStop: stop } : {}) } });
}

const startOfDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export type ReaderState = { pausedUntil: Date | null; pagesToday: number; detailsToday: number; rotation: number };

/**
 * Where the reader stands, from its own run records: paused for `pause_hours_after_challenge` after a run a check or a
 * refusal stopped; the pages and job pages read since midnight UTC; and how many times in 30 days it was turned away,
 * which names its next proxy address (so a refused address is not used again).
 */
export async function readerState(site: string, rules: ReaderRules, now = new Date()): Promise<ReaderState> {
  const stops = ["challenge", "refused"];
  const since30 = new Date(now.getTime() - 30 * 24 * HOUR);
  const [last, today, rotation] = await Promise.all([
    db.readerRun.findFirst({ where: { site, stopReason: { in: stops } }, orderBy: { startedAt: "desc" }, select: { finishedAt: true, startedAt: true } }),
    db.readerRun.aggregate({ where: { site, startedAt: { gte: startOfDay(now) } }, _sum: { pages: true, details: true } }),
    db.readerRun.count({ where: { site, stopReason: { in: stops }, startedAt: { gte: since30 } } }),
  ]);
  const stoppedAt = last ? (last.finishedAt ?? last.startedAt) : null;
  const until = stoppedAt ? new Date(stoppedAt.getTime() + rules.pause_hours_after_challenge * HOUR) : null;
  return { pausedUntil: until && until > now ? until : null, pagesToday: today._sum.pages ?? 0, detailsToday: today._sum.details ?? 0, rotation };
}

/** The window's own name for the proxy: reader N, and after each refusal a new one (egress.ts sessionName). */
export function readerOwner(reader: number, rotation: number) {
  return `reader-${reader}-${rotation}`;
}

export function startReaderRun(site: string, reader: string) {
  return db.readerRun.create({ data: { site, reader }, select: { id: true } });
}

export type ReaderCounts = { buckets: number; pages: number; listed: number; created: number; updated: number; details: number };

export function finishReaderRun(id: string, counts: ReaderCounts, stopReason: string, error: string | null) {
  return db.readerRun.update({ where: { id }, data: { ...counts, finishedAt: new Date(), stopReason, error } });
}
