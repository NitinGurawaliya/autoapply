import { z } from "zod";
import { asDate, plainText } from "../normalize";
import { slugPart, TRACK_SEARCH } from "./naukri";
import { cleanCompanyName } from "./naukriBuckets";
import type { ApplyKind, SearchPage, SiteListing, SiteSearch } from "./siteListing";

/**
 * Hirist listings, as Hirist's own search and job pages fetched them (K17, docs/hirist/TDD.md 2, 4.2). Pure: JSON in,
 * FetchedJob out, no browser (the pages are read in modules/apply/sites/hirist.ts). Shapes as the K17 probe read them on
 * 27 Nov (scripts/hirist-probe.ts): a search page's call (`/job/search`, `/job/keyword/`) answers `{ data: [listing],
 * page, limit, count, totalJobs, totalPages, hasMore }`; the job page's call (`/job/detail?jobcode=<id>`) `{ data: job }`
 * with the posting in `introText`. A listing that applies on another site is kept only when that site is a board we have
 * an adapter for (`applyVia`), as for Naukri.
 */

export const HIRIST_ORIGIN = "https://www.hirist.tech";
export const HIRIST_PAGE_SIZE = 20;

const id = z.union([z.string(), z.number()]).transform(String);
const place = z.object({ name: z.string() });
const tag = z.object({ name: z.string() });
const company = z.object({
  companyId: id.nullish(),
  companyName: z.string().nullish(),
  companyLogoFilePath: z.string().nullish(),
  logo: z.string().nullish(),
});

const listingSchema = z.object({
  id,
  title: z.string(),
  min: z.number().nullish(),
  max: z.number().nullish(),
  createdTimeMs: z.number(),
  tags: z.array(tag).default([]),
  locations: z.array(place).default([]),
  location: z.array(place).default([]),
  workFromHome: z.number().nullish(),
  confidential: z.number().nullish(),
  premium: z.number().nullish(),
  minSal: z.number().nullish(),
  maxSal: z.number().nullish(),
  hideSal: z.number().nullish(),
  jobDesignation: z.string().nullish(),
  jobdesignation: z.string().nullish(),
  applyUrl: z.string().nullish(),
  jobDetailUrl: z.string().nullish(),
  companyData: company.nullish(),
});
type Listing = z.infer<typeof listingSchema>;

const searchSchema = z.object({ data: z.array(z.unknown()).default([]), totalJobs: z.number().nullish() });

const detailSchema = z.object({
  data: z.object({
    id,
    introText: z.string().nullish(),
    min: z.number().nullish(),
    max: z.number().nullish(),
    tags: z.array(tag).default([]),
    locations: z.array(place).default([]),
    otherLocation: z.string().nullish(),
    workFromHome: z.number().nullish(),
    applyUrl: z.string().nullish(),
    hasExpired: z.boolean().nullish(),
    permanentlyRemoved: z.boolean().nullish(),
  }),
});

// Worded "N-M years of experience" so tagging.ts requiredYears reads the lower bound, as on every board.
function years(min: unknown, max: unknown) {
  if (typeof min !== "number" || !Number.isFinite(min)) return "";
  return typeof max === "number" && max > min ? `Hirist lists ${min}-${max} years of experience.` : `Hirist lists ${min} years of experience.`;
}

function describe(body: string, skills: string[], experience: string) {
  return [plainText(body), skills.length > 0 ? `Key skills: ${skills.join(", ")}` : "", experience].filter(Boolean).join("\n\n");
}

/** Where a job is applied to: Hirist's own Apply (no external URL), a board we apply on, or nowhere we can (not stored). */
export function applyKindOf(applyUrl: string | null | undefined, boardOfHost: (host: string) => string | null): { kind: ApplyKind; via: string | null; url: string | null } {
  const raw = (applyUrl ?? "").trim();
  if (!raw) return { kind: "site", via: null, url: null };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "none", via: null, url: null };
  }
  if (url.protocol !== "https:" || url.username || url.password) return { kind: "none", via: null, url: null };
  const board = boardOfHost(url.hostname.toLowerCase());
  return board ? { kind: "board", via: board, url: url.toString() } : { kind: "none", via: null, url: null };
}

/** The job's own page: Hirist's slug is the company and the title, then the id; the id alone opens it (probe, 27 Nov). */
export function jobUrl(listing: { id: string; title: string; companyName: string; jobDetailUrl?: string | null }) {
  const given = (listing.jobDetailUrl ?? "").trim();
  if (given.startsWith("/j/")) return `${HIRIST_ORIGIN}${given}`;
  if (/^https:\/\/(www\.)?hirist\.tech\/j\//i.test(given)) return given;
  const slug = slugPart(`${listing.companyName} ${listing.title}`) || "job";
  return `${HIRIST_ORIGIN}/j/${slug}-${listing.id}`;
}

function toListing(raw: unknown, boardOfHost: (host: string) => string | null): SiteListing | null {
  const parsed = listingSchema.safeParse(raw);
  if (!parsed.success) return null;
  const listing: Listing = parsed.data;
  const companyName = listing.companyData?.companyName?.trim() ?? "";
  const postedAt = asDate(listing.createdTimeMs);
  // A confidential job names no company: nothing to show or match it by.
  if (!listing.title.trim() || !companyName || !postedAt || listing.confidential === 1) return null;
  const apply = applyKindOf(listing.applyUrl, boardOfHost);
  const places = [...new Set((listing.locations.length > 0 ? listing.locations : listing.location).map((item) => item.name.trim()).filter(Boolean))];
  const skills = listing.tags.map((item) => item.name.trim()).filter(Boolean);
  const own = jobUrl({ id: listing.id, title: listing.title, companyName, jobDetailUrl: listing.jobDetailUrl });
  const logo = listing.companyData?.companyLogoFilePath ?? listing.companyData?.logo ?? null;
  return {
    externalId: listing.id,
    title: listing.title.trim(),
    location: places.join(", "),
    description: describe("", skills, years(listing.min, listing.max)),
    applyUrl: apply.kind === "board" && apply.url ? apply.url : own,
    postedAt,
    isRemote: listing.workFromHome === 1 || places.some((name) => /^remote\b|work from home/i.test(name)),
    raw: {
      jobId: listing.id,
      jobUrl: own,
      applyUrl: listing.applyUrl?.trim() || null,
      experience: typeof listing.min === "number" ? `${listing.min}-${listing.max ?? listing.min} years` : null,
      salary: listing.hideSal === 1 || !listing.maxSal ? null : `${listing.minSal ?? 0}-${listing.maxSal}`,
      designation: listing.jobdesignation ?? listing.jobDesignation ?? null,
      premium: listing.premium ?? null,
      skills,
    },
    applyKind: apply.kind,
    applyVia: apply.via,
    company: { slug: String(listing.companyData?.companyId ?? "").trim() || slugPart(companyName), name: companyName, logoUrl: logo && /^https:\/\//i.test(logo) ? logo : null },
  };
}

/** The listings of one search page; a malformed listing is skipped, never guessed. `total` is Hirist's own count. */
export function fromSearch(json: unknown, boardOfHost: (host: string) => string | null): SearchPage {
  const parsed = searchSchema.safeParse(json);
  if (!parsed.success) return { total: null, listings: [], skipped: 0 };
  const listings: SiteListing[] = [];
  let skipped = 0;
  for (const raw of parsed.data.data) {
    const listing = toListing(raw, boardOfHost);
    if (listing) listings.push(listing);
    else skipped += 1;
  }
  return { total: parsed.data.totalJobs ?? null, listings, skipped };
}

/** The listing with the whole posting from the job page: the description, every place, the skills. */
export function withDetail(listing: SiteListing, json: unknown, boardOfHost: (host: string) => string | null): SiteListing {
  const parsed = detailSchema.safeParse(json);
  if (!parsed.success || parsed.data.data.id !== listing.externalId) return listing;
  const detail = parsed.data.data;
  const skills = detail.tags.map((item) => item.name.trim()).filter(Boolean);
  const offices = [...detail.locations.map((item) => item.name.trim()), ...(detail.otherLocation ?? "").split(",").map((name) => name.trim())].filter(Boolean);
  const apply = detail.applyUrl !== undefined && detail.applyUrl !== null ? applyKindOf(detail.applyUrl, boardOfHost) : { kind: listing.applyKind, via: listing.applyVia, url: null };
  return {
    ...listing,
    description: detail.introText ? describe(detail.introText, skills, years(detail.min, detail.max)) : listing.description,
    offices: offices.length > 0 ? [...new Set(offices)] : listing.offices,
    isRemote: listing.isRemote || detail.workFromHome === 1,
    applyKind: apply.kind,
    applyVia: apply.via,
    applyUrl: apply.kind === "board" && apply.url ? apply.url : listing.applyUrl,
    raw: { ...listing.raw, detailed: true, expired: detail.hasExpired === true || detail.permanentlyRemoved === true },
  };
}

/**
 * The searches for a user: the phrase of each of their tracks, then their current title, in their years. Hirist's free-text
 * search has no place filter we can ask for, so a search has no location (the feed filters by place); at most `limit`.
 */
export function planSearches(input: { tracks: string[]; currentTitle: string | null; city: string | null; yearsExperience: number | null }, limit: number): SiteSearch[] {
  const keywords: string[] = [];
  for (const track of input.tracks) {
    const phrase = TRACK_SEARCH[track];
    if (phrase && !keywords.includes(phrase)) keywords.push(phrase);
  }
  const title = input.currentTitle?.trim().toLowerCase().replace(/[^a-z0-9+#. ]+/g, " ").replace(/\s+/g, " ").trim();
  if (title && title.length <= 60 && !keywords.includes(title)) keywords.push(title);
  if (keywords.length === 0) keywords.push(TRACK_SEARCH.software);
  const experience = input.yearsExperience != null && Number.isFinite(input.yearsExperience) ? Math.max(0, Math.round(input.yearsExperience)) : null;
  return keywords.slice(0, Math.max(0, limit)).map((keyword) => ({ keyword, location: null, experience }));
}

/**
 * What Hirist is asked for to find a company's jobs. Its search matches on any word of the phrase ("Cadence Design
 * Systems" answered 20 jobs of other companies, "Cadence" 4 of Cadence's own: probe, 27 Nov), so a company is searched by
 * its first word, or its first two when the first is short; the reader then keeps only the listings of that company
 * (matchesCompany).
 */
export function companyQuery(name: string) {
  const words = cleanCompanyName(name).split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  return (words[0].length >= 4 ? words[0] : words.slice(0, 2).join(" ")).trim();
}

/**
 * Hirist's own search page for a search ("/search/backend%20developer?minexp=2&maxexp=5&page=2"), the page a person would
 * open; page 1 has no number. A company's search is its name (companyQuery) alone. The years go as a window around the band.
 */
export function searchUrl(search: SiteSearch, page: number, kind: "search" | "company" = "search") {
  const query = new URLSearchParams();
  if (kind === "search" && search.experience != null) {
    query.set("minexp", String(Math.max(0, search.experience - 1)));
    query.set("maxexp", String(search.experience + 2));
  }
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  const phrase = kind === "company" ? companyQuery(search.keyword) : search.keyword.trim();
  return `${HIRIST_ORIGIN}/search/${encodeURIComponent(phrase)}${text ? `?${text}` : ""}`;
}
