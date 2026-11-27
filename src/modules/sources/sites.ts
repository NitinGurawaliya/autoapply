/**
 * Job sites a user connects with their own account (Phase K, ARCHITECTURE 6.20, docs/naukri/TDD.md). Plain data, no
 * browser: the web app, the worker and browser.ts all read it. LinkedIn joins with K3.
 */

export const SITES = ["naukri", "hirist"] as const;
export type Site = (typeof SITES)[number];

export type SiteInfo = {
  site: Site;
  label: string;
  /** The registrable domain whose cookies and storage make up the saved sign-in; nothing else is kept. */
  domain: string;
  /** Where the user signs in, in the visible window. */
  loginUrl: string;
  /** A page only a signed-in account sees; opening it signed out lands on the login page. */
  homeUrl: string;
};

export const SITE_INFO: Record<Site, SiteInfo> = {
  naukri: {
    site: "naukri",
    label: "Naukri",
    domain: "naukri.com",
    loginUrl: "https://www.naukri.com/nlogin/login",
    homeUrl: "https://www.naukri.com/mnjuser/homepage",
  },
  // Hirist (K16-K19, docs/hirist/TDD.md): login and signed-in page confirmed in the connect task (K18); the reader (K17)
  // needs only the domain and the front page.
  hirist: {
    site: "hirist",
    label: "Hirist",
    domain: "hirist.tech",
    loginUrl: "https://www.hirist.tech/",
    homeUrl: "https://www.hirist.tech/",
  },
};

export function isSite(value: string): value is Site {
  return (SITES as readonly string[]).includes(value);
}

/** Whether a host belongs to the site's domain ("www.naukri.com", "login.naukri.com", ".naukri.com"). */
export function onSiteDomain(host: string, site: Site) {
  const domain = SITE_INFO[site].domain;
  const bare = host.replace(/^\./, "").toLowerCase();
  return bare === domain || bare.endsWith(`.${domain}`);
}

/** The storage key of a user's saved sign-in to a site (browser.ts keeps the ATS cookie jar apart from it). */
export function siteStateKey(userId: string, site: Site) {
  const owner = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!owner) throw new Error("A saved sign-in needs an owner");
  return `browser-state/${owner}/${site}.json`;
}
