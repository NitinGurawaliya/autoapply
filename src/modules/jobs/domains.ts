import { NOT_OWN_SITE, siteRoot } from "./logos";

// Which website domain is an employer's own (Phase W, docs/employers/TDD.md 4.4). Pure: no network, no database.

/** Hosts where one more label is the site ("acme.github.io", not "github.io"). */
const SHARED_HOSTS = ["github.io", "vercel.app", "netlify.app", "herokuapp.com", "wixsite.com", "webflow.io", "framer.website", "notion.site", "blogspot.com", "wordpress.com", "carrd.co", "pages.dev"];

/** Mail providers, socials and link hosts: never a company's own website, though a board field may name one. */
const NOT_EMPLOYER_HOST = /(^|\.)(gmail\.com|outlook\.com|hotmail\.com|yahoo\.com|linktr\.ee|linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|youtube\.com|medium\.com|google\.com|wa\.me|t\.me)$/i;

const IP_ADDRESS = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * The registrable domain of an address or host as an employer's identity ("https://www.Razorpay.com/careers" →
 * "razorpay.com", "careers.toddleapp.com" → "toddleapp.com", "acme.github.io" stays), or null when it cannot be an
 * employer's own site: a job board or ATS, a social or mail host, an IP address, a host without a dot.
 */
export function employerDomain(urlOrHost: string | null | undefined): string | null {
  const text = (urlOrHost ?? "").trim();
  if (!text) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`).hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return null;
  }
  if (!host.includes(".") || IP_ADDRESS.test(host) || !/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.includes("..")) return null;
  if (host === "sites.google.com") return null;
  const shared = SHARED_HOSTS.find((suffix) => host.endsWith(`.${suffix}`));
  const root = shared ? host.split(".").slice(-(shared.split(".").length + 1)).join(".") : siteRoot(host);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(root) || !/[a-z]{2,}$/.test(root)) return null;
  if (NOT_OWN_SITE.test(root) || NOT_EMPLOYER_HOST.test(root)) return null;
  return root;
}

/** A board's name for a company that says nothing about it ("Careers", "Jobs", empty): the facts sweep replaces it. */
export function isGenericCompanyName(name: string | null | undefined): boolean {
  return /^(|careers?|jobs?|career portal|careers page|job openings|current openings|openings|home|join us)$/i.test((name ?? "").trim());
}
