import { z } from "zod";
import { asDate, plainText, type FetchedJob } from "../normalize";

/**
 * Naukri listings, as Naukri's own search and job pages fetched them in the user's signed-in window (Phase K,
 * docs/naukri/TDD.md 4.6). Pure: JSON in, FetchedJob out, no browser (the pages are read in modules/apply/sites/naukri.ts).
 * A listing Naukri does not apply to itself sends the user to the company's site: kept only when that site is a board we
 * have an adapter for (`applyVia`), never otherwise, so the feed never offers a job the agent cannot apply to.
 */

export const NAUKRI_ORIGIN = "https://www.naukri.com";

/** Where a Naukri job is applied to: Naukri's own Apply, a board we apply on, or nowhere we can (not stored). */
export type ApplyKind = "naukri" | "board" | "none";

export type NaukriListing = FetchedJob & {
  applyKind: ApplyKind;
  /** The board whose adapter applies, for a job that leaves Naukri for it ("greenhouse"); null for Naukri's own Apply. */
  applyVia: string | null;
  company: { slug: string; name: string; logoUrl: string | null };
};

const placeholderSchema = z.object({ type: z.string(), label: z.string() });
const listingSchema = z.object({
  jobId: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  companyName: z.string(),
  companyId: z.union([z.string(), z.number()]).nullish(),
  groupId: z.union([z.string(), z.number()]).nullish(),
  logoPath: z.string().nullish(),
  jdURL: z.string(),
  placeholders: z.array(placeholderSchema).default([]),
  tagsAndSkills: z.string().nullish(),
  jobDescription: z.string().nullish(),
  createdDate: z.union([z.number(), z.string()]),
  minimumExperience: z.union([z.string(), z.number()]).nullish(),
  maximumExperience: z.union([z.string(), z.number()]).nullish(),
  companyApplyJob: z.boolean().nullish(),
  applyRedirectUrl: z.string().nullish(),
  questionnaireIdPresent: z.boolean().nullish(),
  mode: z.string().nullish(),
  wfhType: z.union([z.string(), z.number()]).nullish(),
  consultant: z.boolean().nullish(),
  walkinJob: z.boolean().nullish(),
});
type Listing = z.infer<typeof listingSchema>;

const searchSchema = z.object({ noOfJobs: z.number().nullish(), jobDetails: z.array(z.unknown()).default([]) });

const detailSchema = z.object({
  jobDetails: z.object({
    jobId: z.union([z.string(), z.number()]).transform(String),
    description: z.string().nullish(),
    locations: z.array(z.object({ label: z.string() })).default([]),
    keySkills: z.object({ other: z.array(z.object({ label: z.string() })).default([]), preferred: z.array(z.object({ label: z.string() })).default([]) }).nullish(),
    wfhType: z.union([z.string(), z.number()]).nullish(),
    minimumExperience: z.union([z.string(), z.number()]).nullish(),
    maximumExperience: z.union([z.string(), z.number()]).nullish(),
    hideApplyButton: z.boolean().nullish(),
  }),
});

const placeholder = (listing: Listing, type: string) => listing.placeholders.find((item) => item.type === type)?.label.trim() ?? "";

// Worded "N-M years of experience" so tagging.ts requiredYears reads the lower bound, as it does on every board
// ("Experience: 1-3 years" was read as 3).
function years(min: unknown, max: unknown) {
  if (min === null || min === undefined || min === "") return "";
  const low = Number(min);
  const high = Number(max);
  if (!Number.isFinite(low)) return "";
  return Number.isFinite(high) && high > low ? `Naukri lists ${low}-${high} years of experience.` : `Naukri lists ${low} years of experience.`;
}

/** The text tagging, matching and the feed's `terms` read: description, then the skills and years Naukri lists apart. */
function describe(body: string, skills: string[], experience: string) {
  return [plainText(body), skills.length > 0 ? `Key skills: ${skills.join(", ")}` : "", experience].filter(Boolean).join("\n\n");
}

/**
 * How the listing is applied to. `boardOfHost` names the board whose form host a URL is on (boards.ts formHost), or
 * null; passed in so this file stays free of the board registry.
 */
export function applyKindOf(listing: { companyApplyJob?: boolean | null; applyRedirectUrl?: string | null }, boardOfHost: (host: string) => string | null): { kind: ApplyKind; via: string | null; url: string | null } {
  if (!listing.companyApplyJob) return { kind: "naukri", via: null, url: null };
  if (!listing.applyRedirectUrl) return { kind: "none", via: null, url: null };
  let url: URL;
  try {
    url = new URL(listing.applyRedirectUrl);
  } catch {
    return { kind: "none", via: null, url: null };
  }
  if (url.protocol !== "https:" || url.username || url.password) return { kind: "none", via: null, url: null };
  const board = boardOfHost(url.hostname.toLowerCase());
  return board ? { kind: "board", via: board, url: url.toString() } : { kind: "none", via: null, url: null };
}

function toListing(raw: unknown, boardOfHost: (host: string) => string | null): NaukriListing | null {
  const parsed = listingSchema.safeParse(raw);
  if (!parsed.success) return null;
  const listing = parsed.data;
  const postedAt = asDate(typeof listing.createdDate === "string" && /^\d+$/.test(listing.createdDate) ? Number(listing.createdDate) : listing.createdDate);
  if (!listing.title.trim() || !postedAt || !listing.jdURL.startsWith("/")) return null;
  const apply = applyKindOf(listing, boardOfHost);
  const skills = (listing.tagsAndSkills ?? "").split(",").map((skill) => skill.trim()).filter(Boolean);
  const slug = String(listing.groupId ?? listing.companyId ?? "").trim() || listing.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const logo = listing.logoPath && /^https:\/\//i.test(listing.logoPath) ? listing.logoPath : null;
  return {
    externalId: listing.jobId,
    title: listing.title.trim(),
    location: placeholder(listing, "location"),
    description: describe(listing.jobDescription ?? "", skills, years(listing.minimumExperience, listing.maximumExperience)),
    applyUrl: apply.kind === "board" && apply.url ? apply.url : `${NAUKRI_ORIGIN}${listing.jdURL}`,
    postedAt,
    isRemote: String(listing.wfhType ?? "") === "2" || /^remote\b/i.test(placeholder(listing, "location")),
    raw: {
      jobId: listing.jobId,
      jdURL: listing.jdURL,
      companyApplyJob: listing.companyApplyJob ?? null,
      applyRedirectUrl: listing.applyRedirectUrl ?? null,
      questionnaireIdPresent: listing.questionnaireIdPresent ?? null,
      mode: listing.mode ?? null,
      wfhType: listing.wfhType ?? null,
      consultant: listing.consultant ?? null,
      walkinJob: listing.walkinJob ?? null,
      experience: placeholder(listing, "experience") || null,
      salary: placeholder(listing, "salary") || null,
      tagsAndSkills: listing.tagsAndSkills ?? null,
    },
    applyKind: apply.kind,
    applyVia: apply.via,
    company: { slug, name: listing.companyName.trim(), logoUrl: logo },
  };
}

/** The listings of one search page; a malformed listing is skipped, never guessed. `total` is Naukri's own count. */
export function fromSearch(json: unknown, boardOfHost: (host: string) => string | null): { total: number | null; listings: NaukriListing[]; skipped: number } {
  const parsed = searchSchema.safeParse(json);
  if (!parsed.success) return { total: null, listings: [], skipped: 0 };
  const listings: NaukriListing[] = [];
  let skipped = 0;
  for (const raw of parsed.data.jobDetails) {
    const listing = toListing(raw, boardOfHost);
    if (listing) listings.push(listing);
    else skipped += 1;
  }
  return { total: parsed.data.noOfJobs ?? null, listings, skipped };
}

/** The listing with the full posting from the job page: whole description, every location, skills, work type. */
export function withDetail(listing: NaukriListing, json: unknown): NaukriListing {
  const parsed = detailSchema.safeParse(json);
  if (!parsed.success || parsed.data.jobDetails.jobId !== listing.externalId) return listing;
  const detail = parsed.data.jobDetails;
  const skills = [...(detail.keySkills?.preferred ?? []), ...(detail.keySkills?.other ?? [])].map((skill) => skill.label.trim()).filter(Boolean);
  const description = detail.description ? describe(detail.description, skills, years(detail.minimumExperience, detail.maximumExperience)) : listing.description;
  return {
    ...listing,
    description,
    offices: detail.locations.map((place) => place.label.trim()).filter(Boolean),
    isRemote: listing.isRemote || String(detail.wfhType ?? "") === "2",
    raw: { ...listing.raw, detailed: true, hideApplyButton: detail.hideApplyButton ?? null },
  };
}

// The phrase Naukri is searched with for each of our tracks (modules/jobs/functions.ts TRACKS).
const TRACK_SEARCH: Record<string, string> = {
  ml_ai: "machine learning engineer",
  data_science: "data scientist",
  data_engineering: "data engineer",
  security: "security engineer",
  devops: "devops engineer",
  mobile: "mobile developer",
  frontend: "frontend developer",
  backend: "backend developer",
  fullstack: "full stack developer",
  qa: "qa engineer",
  embedded: "embedded engineer",
  solutions: "solutions engineer",
  eng_management: "engineering manager",
  software: "software engineer",
};

export type NaukriSearch = { keyword: string; location: string | null; experience: number | null };

const slugPart = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * The searches one run makes for a user, from what they already told us: their tracks' phrases, then their current
 * title; their city; their years. At most `limit`.
 */
export function planSearches(input: { tracks: string[]; currentTitle: string | null; city: string | null; yearsExperience: number | null }, limit: number): NaukriSearch[] {
  const keywords: string[] = [];
  for (const track of input.tracks) {
    const phrase = TRACK_SEARCH[track];
    if (phrase && !keywords.includes(phrase)) keywords.push(phrase);
  }
  const title = input.currentTitle?.trim().toLowerCase().replace(/[^a-z0-9+#. ]+/g, " ").replace(/\s+/g, " ").trim();
  if (title && title.length <= 60 && !keywords.includes(title)) keywords.push(title);
  if (keywords.length === 0) keywords.push(TRACK_SEARCH.software);
  const city = input.city?.trim() ? input.city.trim() : null;
  const experience = input.yearsExperience != null && Number.isFinite(input.yearsExperience) ? Math.max(0, Math.round(input.yearsExperience)) : null;
  return keywords.slice(0, Math.max(0, limit)).map((keyword) => ({ keyword, location: city, experience }));
}

/**
 * Naukri's own search page for a search ("/backend-developer-jobs-in-bengaluru-2?experience=2&jobAge=7"), the page a
 * person would open; jobs posted in the last `jobAge` days. Page 1 has no number.
 */
export function searchUrl(search: NaukriSearch, page: number, jobAge = 7) {
  const path = `${slugPart(search.keyword)}-jobs${search.location ? `-in-${slugPart(search.location)}` : ""}${page > 1 ? `-${page}` : ""}`;
  const query = new URLSearchParams();
  if (search.experience != null) query.set("experience", String(search.experience));
  query.set("jobAge", String(jobAge));
  return `${NAUKRI_ORIGIN}/${path}?${query.toString()}`;
}
