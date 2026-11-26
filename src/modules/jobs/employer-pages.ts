import { db } from "@/lib/db";
import { APPLY_BOARDS } from "./pool";
import { PRIVATE_SOURCES } from "./private-sources";

// What the public company pages read (Phase W, docs/employers/TDD.md 4.9): named columns only, never `raw`,
// `questions`, an embedding or anything about a user; signed-in sources (Naukri) and the mock board never appear, and a
// job counts only while its company was read in the last 3 days (the same rule as Employer.openJobs).

export const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
export const EMPLOYERS_PER_PAGE = 200;
export const JOBS_PER_PAGE = 50;

export type EmployerRow = { slug: string; name: string; logoUrl: string | null; openJobs: number; openIndia: number; places: string };
export type EmployerHead = Omit<EmployerRow, "places"> & { domain: string | null; boards: string[] };
export type EmployerJobRow = { id: string; title: string; location: string; remoteType: string; postedAt: Date; source: string; companyName: string };
export type EmployerPage =
  | { kind: "page"; employer: EmployerHead; india: EmployerJobRow[]; abroad: EmployerJobRow[]; page: number; pages: number }
  | { kind: "redirect"; slug: string };

const PRIVATE = [...PRIVATE_SOURCES];

/** "Bengaluru", "Bengaluru and Pune", "Bengaluru, Pune and 40 more": the cities an employer's open India jobs are in. */
export function placesLine(locations: Array<{ location: string; n: number }>): string {
  const cities = new Map<string, number>();
  for (const row of locations) {
    const city = row.location.split(/[,;|/]/)[0]?.trim();
    if (city && city.length >= 2) cities.set(city, (cities.get(city) ?? 0) + row.n);
  }
  const ranked = [...cities].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([city]) => city);
  if (ranked.length === 0) return "";
  if (ranked.length === 1) return ranked[0]!;
  if (ranked.length === 2) return `${ranked[0]} and ${ranked[1]}`;
  return `${ranked[0]}, ${ranked[1]} and ${ranked.length - 2} more`;
}

type EmployerBase = { id: string; slug: string; name: string; logoUrl: string | null; openJobs: number; openIndia: number };

/** The cities of each employer's open India jobs, one read for a whole list. */
async function withPlaces(rows: EmployerBase[]): Promise<EmployerRow[]> {
  if (rows.length === 0) return [];
  const locations = await db.$queryRaw<Array<{ employerId: string; location: string; n: number }>>`
    SELECT c."employerId", j.location, count(*)::int AS n
    FROM "Company" c JOIN "Job" j ON j."companyId" = c.id
    WHERE c."employerId" = ANY(${rows.map((row) => row.id)}::text[]) AND j."closedAt" IS NULL
      AND j.eligibility IN ('india', 'remote_india') AND j.source <> ALL(${PRIVATE}::text[])
      AND c."lastFetchedAt" > now() - interval '3 days'
    GROUP BY 1, 2`;
  const by = new Map<string, Array<{ location: string; n: number }>>();
  for (const row of locations) by.set(row.employerId, [...(by.get(row.employerId) ?? []), { location: row.location, n: row.n }]);
  return rows.map(({ id, ...row }) => ({ ...row, places: placesLine(by.get(id) ?? []) }));
}

/** How many listed employers start with each letter ("0" for a digit or anything else). */
export async function letterCounts(): Promise<Array<{ letter: string; count: number }>> {
  return db.$queryRaw<Array<{ letter: string; count: number }>>`
    SELECT CASE WHEN left("nameKey", 1) ~ '[a-z]' THEN left("nameKey", 1) ELSE '0' END AS letter, count(*)::int AS count
    FROM "Employer" WHERE "openJobs" > 0 GROUP BY 1 ORDER BY 1`;
}

/** The employers with the most open India jobs. */
export async function topEmployers(n = 30): Promise<EmployerRow[]> {
  const rows = await db.$queryRaw<EmployerBase[]>`
    SELECT id, slug, name, "logoUrl", "openJobs", "openIndia" FROM "Employer"
    WHERE "openIndia" > 0 ORDER BY "openIndia" DESC, "openJobs" DESC, "nameKey" ASC LIMIT ${n}`;
  return withPlaces(rows);
}

/** Listed employers whose name starts with `letter` ("a"-"z", or "0" for the rest), alphabetical, 200 a page. */
export async function employersByLetter(letter: string, page: number): Promise<{ rows: EmployerRow[]; total: number; pages: number }> {
  if (letter !== "0" && !LETTERS.includes(letter)) return { rows: [], total: 0, pages: 0 };
  const like = letter === "0" ? null : `${letter}%`;
  const [counted] = await db.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM "Employer" WHERE "openJobs" > 0 AND (${like}::text IS NULL AND left("nameKey", 1) !~ '[a-z]' OR "nameKey" LIKE ${like})`;
  const total = counted?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / EMPLOYERS_PER_PAGE));
  const at = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const rows = await db.$queryRaw<EmployerBase[]>`
    SELECT id, slug, name, "logoUrl", "openJobs", "openIndia" FROM "Employer"
    WHERE "openJobs" > 0 AND (${like}::text IS NULL AND left("nameKey", 1) !~ '[a-z]' OR "nameKey" LIKE ${like})
    ORDER BY "nameKey" ASC, slug ASC LIMIT ${EMPLOYERS_PER_PAGE} OFFSET ${(at - 1) * EMPLOYERS_PER_PAGE}`;
  return { rows: await withPlaces(rows), total, pages };
}

/**
 * Whether a company address leads anywhere, before the page streams (a layout asks, so a missing company is a real 404
 * and an old slug a real 308: a status cannot change once a loading screen has started the response). Two small reads.
 */
export async function employerRoute(slug: string): Promise<{ kind: "ok" } | { kind: "redirect"; slug: string } | null> {
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return null;
  const employer = await db.employer.findUnique({ where: { slug }, select: { openJobs: true } });
  if (employer) return employer.openJobs > 0 ? { kind: "ok" } : null;
  const alias = await db.employerAlias.findUnique({ where: { slug }, select: { employer: { select: { slug: true, openJobs: true } } } });
  return alias && alias.employer.openJobs > 0 ? { kind: "redirect", slug: alias.employer.slug } : null;
}

/**
 * One employer's page: the employer and its open public jobs, India and remote India first, then the rest, newest
 * first, 50 to a page. An old slug (a merged employer's) gives a redirect; an unknown slug, or an employer with no open
 * public job, gives null (a 404).
 */
export async function employerPage(slug: string, page: number): Promise<EmployerPage | null> {
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return null;
  const employer = await db.employer.findUnique({ where: { slug }, select: { id: true, slug: true, name: true, logoUrl: true, domain: true, openJobs: true, openIndia: true } });
  if (!employer) {
    const alias = await db.employerAlias.findUnique({ where: { slug }, select: { employer: { select: { slug: true, openJobs: true } } } });
    return alias && alias.employer.openJobs > 0 ? { kind: "redirect", slug: alias.employer.slug } : null;
  }
  if (employer.openJobs <= 0) return null;
  const pages = Math.max(1, Math.ceil(employer.openJobs / JOBS_PER_PAGE));
  const at = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const jobs = await db.$queryRaw<Array<EmployerJobRow & { india: boolean }>>`
    SELECT j.id, j.title, j.location, j."remoteType", j."postedAt", j.source, c.name AS "companyName",
           (j.eligibility IN ('india', 'remote_india')) AS india
    FROM "Company" c JOIN "Job" j ON j."companyId" = c.id
    WHERE c."employerId" = ${employer.id} AND j."closedAt" IS NULL AND j.source <> ALL(${PRIVATE}::text[])
      AND c."lastFetchedAt" > now() - interval '3 days'
    ORDER BY (j.eligibility IN ('india', 'remote_india')) DESC, j."postedAt" DESC, j.id ASC
    LIMIT ${JOBS_PER_PAGE} OFFSET ${(at - 1) * JOBS_PER_PAGE}`;
  const boards = await db.$queryRaw<Array<{ source: string }>>`
    SELECT j.source FROM "Company" c JOIN "Job" j ON j."companyId" = c.id
    WHERE c."employerId" = ${employer.id} AND j."closedAt" IS NULL AND j.source <> ALL(${PRIVATE}::text[]) AND c."lastFetchedAt" > now() - interval '3 days'
    GROUP BY j.source ORDER BY count(*) DESC, j.source`;
  const { id: _id, ...head } = employer;
  void _id;
  const plain = (job: EmployerJobRow & { india: boolean }): EmployerJobRow => {
    const { india, ...rest } = job;
    void india;
    return rest;
  };
  return {
    kind: "page",
    employer: { ...head, boards: boards.map((row) => row.source) },
    india: jobs.filter((job) => job.india).map(plain),
    abroad: jobs.filter((job) => !job.india).map(plain),
    page: at,
    pages,
  };
}

// The sitemaps (W7): the listed employers, and the open jobs whose page carries JobPosting data (an open job of a public
// source on a board the agent applies on, its company read in the last 3 days: lib/job-posting.ts postingIndexable).
export const SITEMAP_JOBS_PER_FILE = 45_000;
const BOARDS = [...APPLY_BOARDS];

/** How many open jobs have an indexable page. */
export async function indexableJobCount(): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
    WHERE j."closedAt" IS NULL AND j.source = ANY(${BOARDS}::text[]) AND j.source <> ALL(${PRIVATE}::text[])
      AND c."lastFetchedAt" > now() - interval '3 days'`;
  return row?.n ?? 0;
}

/** Every listed employer's slug and when its jobs were last read. */
export async function sitemapEmployers(): Promise<Array<{ slug: string; updatedAt: Date }>> {
  return db.$queryRaw<Array<{ slug: string; updatedAt: Date }>>`SELECT slug, "updatedAt" FROM "Employer" WHERE "openJobs" > 0 ORDER BY slug`;
}

/** One file's worth of indexable open jobs, in a stable order. */
export async function sitemapJobs(file: number): Promise<Array<{ id: string; title: string; companyName: string; fetchedAt: Date }>> {
  return db.$queryRaw<Array<{ id: string; title: string; companyName: string; fetchedAt: Date }>>`
    SELECT j.id, j.title, c.name AS "companyName", j."fetchedAt"
    FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
    WHERE j."closedAt" IS NULL AND j.source = ANY(${BOARDS}::text[]) AND j.source <> ALL(${PRIVATE}::text[])
      AND c."lastFetchedAt" > now() - interval '3 days'
    ORDER BY j.id LIMIT ${SITEMAP_JOBS_PER_FILE} OFFSET ${file * SITEMAP_JOBS_PER_FILE}`;
}
