import type { FetchedJob } from "../normalize";

/**
 * A listing read from a signed-in portal's own pages (Naukri, Hirist; docs/hirist/TDD.md 4.1). Pure types: each site's
 * fetcher turns the JSON its page fetched into these, and storeSiteListings stores them as ordinary Job rows.
 */

/** Where a job is applied to: the portal's own Apply, a board we apply on, or nowhere we can (not stored). */
export type ApplyKind = "site" | "board" | "none";

export type SiteListing = FetchedJob & {
  applyKind: ApplyKind;
  /** The board whose adapter applies, for a job that leaves the portal for it ("greenhouse"); null for the portal's own Apply. */
  applyVia: string | null;
  company: { slug: string; name: string; logoUrl: string | null };
};

/** One search as the reader and a user's run ask for it; each site turns it into its own URL. */
export type SiteSearch = { keyword: string; location: string | null; experience: number | null };

/** One search page: the listings kept, how many were dropped as unreadable, and the total the site reports. */
export type SearchPage = { total: number | null; listings: SiteListing[]; skipped: number };
