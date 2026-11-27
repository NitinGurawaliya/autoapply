import type { Page } from "playwright";
import { adapterBoardOfHost } from "@/modules/jobs/boards";
import { fromSearch, NAUKRI_ORIGIN, searchUrl, withDetail } from "@/modules/jobs/fetchers/naukri";
import type { BucketInput } from "@/modules/jobs/fetchers/naukriBuckets";
import type { SearchPage, SiteListing, SiteSearch } from "@/modules/jobs/fetchers/siteListing";
import { plannerOf } from "@/modules/jobs/fetchers/siteSearches";
import type { Site } from "@/modules/sources";
import { onSignedInPage, readJob, readSearch, waitForSignIn, type SignInResult } from "./naukri";
import { enterLoginCode, sendLoginCode, type OtpStep } from "./naukriOtp";
import type { PageRead, PageStop } from "./read";

export type { OtpStep } from "./naukriOtp";
export type { SignInResult } from "./naukri";

/**
 * One driver per signed-in portal (docs/hirist/TDD.md 4.1): what differs between Naukri and Hirist, behind one shape, so
 * the shared reader, a user's own read and the connect stay one piece of code. The apply part joins in K19, when a second
 * site applies.
 */
export type SiteDriver = {
  site: Site;
  label: string;
  reader: {
    /** The site's public front page, as a visitor opens it (signed out). */
    frontUrl: string;
    /** Listings a full search page holds: a page with fewer is the last. */
    pageSize: number;
    /** A search as the site's own search page URL; `kind` company asks for one company's jobs. */
    searchUrl(search: SiteSearch, page: number, jobAge: number, kind: "search" | "company"): string;
    /** The site's own search page, and the listings its own script fetched. */
    readSearch(page: Page, url: string): Promise<PageRead>;
    /** The site's own job page, and the posting its own script fetched. */
    readJob(page: Page, url: string, jobId: string): Promise<PageRead>;
    parseSearch(json: unknown): SearchPage;
    parseDetail(listing: SiteListing, json: unknown): SiteListing;
    /** A failed read that only means the search found nothing (Naukri answers 400). */
    emptySearch(read: { stop: PageStop; detail: string }): boolean;
    /** A user's searches, field first, at most `limit`. */
    searchesFor(input: BucketInput, limit: number): SiteSearch[];
  };
  login: {
    /** What the user signs in with on the site's OTP page. */
    loginId: "mobile" | "mobile_or_email";
    waitForSignIn(page: Page, timeoutMs: number, cancelled: () => Promise<boolean>): Promise<SignInResult>;
    onSignedInPage(page: Page): boolean;
    sendCode(page: Page, loginId: string): Promise<OtpStep>;
    enterCode(page: Page, code: string): Promise<OtpStep>;
  };
};

const naukri: SiteDriver = {
  site: "naukri",
  label: "Naukri",
  reader: {
    frontUrl: `${NAUKRI_ORIGIN}/`,
    pageSize: 20,
    searchUrl: (search, page, jobAge) => searchUrl(search, page, jobAge),
    readSearch,
    readJob,
    parseSearch: (json) => fromSearch(json, adapterBoardOfHost),
    parseDetail: withDetail,
    // A search that finds nothing gets a client error from Naukri (27 Nov: "machine learning engineer" in remote, 1 year,
    // last 7 days answered 400): an empty search, not a failed one.
    emptySearch: (read) => read.stop === "error" && /answered (400|404)\b/.test(read.detail),
    searchesFor: plannerOf("naukri"),
  },
  login: { loginId: "mobile", waitForSignIn, onSignedInPage, sendCode: sendLoginCode, enterCode: enterLoginCode },
};

const DRIVERS: Record<Site, SiteDriver> = { naukri };

export function driverOf(site: Site): SiteDriver {
  return DRIVERS[site];
}
