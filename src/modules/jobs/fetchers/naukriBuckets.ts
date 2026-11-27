import { planSearches, slugPart, type NaukriSearch } from "./naukri";
import type { SearchPlanner } from "./siteSearches";

/**
 * Search buckets for the shared Naukri reader (K14, docs/naukri/TDD.md 13.17): the searches every connected user wants,
 * deduped, so a search many users share is read once a window by our own signed-out reader and its jobs are shared.
 * Pure: profiles in, buckets out, no browser and no database (modules/sources/reader.ts keeps the rows).
 */

/** Years of experience Naukri's filter is asked for: a user's years go to the nearest, so users share a bucket. */
export const EXPERIENCE_BANDS = [1, 3, 6, 10] as const;

export type Bucket = { key: string; keyword: string; location: string | null; experience: number | null };
export type BucketInput = { tracks: string[]; currentTitle: string | null; city: string | null; yearsExperience: number | null };
export type PlannedBucket = Bucket & { users: number };

/** The band a number of years belongs to; null (years unknown) stays null, a search with no experience filter. */
export function bandOf(years: number | null): number | null {
  if (years == null || !Number.isFinite(years)) return null;
  const clamped = Math.max(0, years);
  return EXPERIENCE_BANDS.reduce((best, band) => (Math.abs(band - clamped) < Math.abs(best - clamped) ? band : best), EXPERIENCE_BANDS[0]);
}

/** One bucket's identity: what it searches, in words that cannot differ by spelling ("Backend  Developer" = "backend-developer"). */
export function bucketKey(search: Pick<NaukriSearch, "keyword" | "location" | "experience">) {
  return `${slugPart(search.keyword)}|${search.location ? slugPart(search.location) : ""}|${search.experience ?? ""}`;
}

/** The buckets one user's searches fall into, field first as their own run would search them (planSearches). */
export function bucketsOf(input: BucketInput, limit: number, plan: SearchPlanner = planSearches): Bucket[] {
  const seen = new Set<string>();
  const buckets: Bucket[] = [];
  for (const search of plan(input, limit)) {
    const experience = bandOf(search.experience);
    const bucket: Bucket = { key: bucketKey({ keyword: search.keyword, location: search.location, experience }), keyword: search.keyword, location: search.location, experience };
    if (!seen.has(bucket.key)) {
      seen.add(bucket.key);
      buckets.push(bucket);
    }
  }
  return buckets;
}

/**
 * Every user's buckets together, with how many users each serves: the most wanted first, at most `max`. Cost follows the
 * number of distinct buckets, not the number of users.
 */
export function planBuckets(inputs: BucketInput[], options: { perUser: number; max: number; plan?: SearchPlanner }): PlannedBucket[] {
  const planned = new Map<string, PlannedBucket>();
  for (const input of inputs) {
    for (const bucket of bucketsOf(input, options.perUser, options.plan)) {
      const known = planned.get(bucket.key);
      if (known) known.users += 1;
      else planned.set(bucket.key, { ...bucket, users: 1 });
    }
  }
  return [...planned.values()].sort((a, b) => b.users - a.users || a.key.localeCompare(b.key)).slice(0, Math.max(0, options.max));
}

/** Hours between reads of a bucket: the more users it serves, the fresher it is kept (config: `reader_every_hours`). */
export function everyHours(users: number, tiers: ReadonlyArray<{ users: number; hours: number }>) {
  const fitting = tiers.filter((tier) => users >= tier.users).sort((a, b) => b.users - a.users)[0];
  return fitting?.hours ?? Math.max(...tiers.map((tier) => tier.hours), 24);
}

/**
 * Days of postings a read asks for: a bucket read lately only needs the newest, one never read (or long ago) a week. A
 * company's own jobs are fewer and slower to change: a month the first time, a week after.
 */
export function jobAgeFor(lastReadAt: Date | null, now = new Date(), kind: "search" | "company" = "search") {
  if (kind === "company") {
    if (!lastReadAt) return 30;
    return (now.getTime() - lastReadAt.getTime()) / 3_600_000 <= 7 * 24 ? 7 : 30;
  }
  if (!lastReadAt) return 7;
  const hours = (now.getTime() - lastReadAt.getTime()) / 3_600_000;
  return hours <= 72 ? 3 : 7;
}

/** A company name as a search phrase: trailing dots and stray spacing gone ("Kotak Mahindra Bank Ltd.." is "Kotak Mahindra Bank Ltd"). */
export function cleanCompanyName(name: string) {
  return name.replace(/\s+/g, " ").replace(/[.,;:\s]+$/g, "").trim();
}

/** The bucket of one company's own jobs, searched by its name with no place and no years. */
export function companyBucket(name: string): Bucket | null {
  const keyword = cleanCompanyName(name);
  const slug = slugPart(keyword);
  return keyword.length >= 2 && slug ? { key: `co|${slug}`, keyword, location: null, experience: null } : null;
}

const SUFFIX = /\b(?:ltd|limited|pvt|private|inc|llp|llc|corp|corporation|the)\b/g;
const plain = (name: string) => name.toLowerCase().replace(SUFFIX, " ").replace(/[^a-z0-9]+/g, "");

/**
 * Whether a listing's company is the one a company bucket searched for. Naukri's own spelling differs ("Jones Lang
 * LaSalle (JLL)", "FedEx", "Kotak Mahindra Bank"), so one name inside the other counts (when it is four letters or more);
 * a listing kept this way is stored under its own company, so a loose match never mislabels a job.
 */
export function matchesCompany(searched: string, listed: string) {
  const a = plain(searched);
  const b = plain(listed);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.includes(short);
}
