import type { BrowserContext, Page } from "playwright";
import type { Site } from "@/modules/sources/sites";

/**
 * Lean pages for a signed-in site's window (K15, owner 25 Nov: "don't load the images, fonts and all, make it as
 * small as possible"; TDD §13.11 "no page images"). Every byte goes through the user's residential proxy, which is
 * billed by the GB: a read was 3-4 MB a page, and one heavy job page (33 MB) did not finish loading through it.
 *
 * Chrome's own URL blocking (DevTools `Network.setBlockedURLs`), set on every page of the window as it opens: Chrome
 * drops a matching request itself. Not Playwright's request interception: on the stealthy Chrome it held every request
 * and the page never loaded (25 Nov). What is dropped, measured on a Naukri search page that day:
 *   - pictures, video, audio and fonts, by file type and by the site's image hosts;
 *   - the site's log pings;
 *   - ad, tag and analytics services (Google's ads and tag manager, Facebook, Hotjar, Clarity and the like).
 * Kept: the site's own pages, scripts, styles and data calls, which draw and run its pages, and Google's reCAPTCHA, which
 * the site may show (the user's to answer). Within one window Chrome's own cache serves a script again to the next page.
 *
 * SIGNED_IN_LEAN=0 turns it off (to compare, or to debug a page).
 */

const MEDIA = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp", "mp4", "webm", "m4a", "mp3", "ogg", "wav", "woff", "woff2", "ttf", "otf", "eot"];
const COMMON: string[] = [
  ...MEDIA.flatMap((ext) => [`*.${ext}`, `*.${ext}?*`]),
  // Ads, tags and analytics.
  "*googletagmanager.com*",
  "*googletagservices.com*",
  "*google-analytics.com*",
  "*analytics.google.com*",
  "*doubleclick.net*",
  "*googlesyndication.com*",
  "*googleadservices.com*",
  "*adservice.google.*",
  "*adtrafficquality.google*",
  "*facebook.net*",
  "*facebook.com/tr*",
  "*connect.facebook*",
  "*hotjar.com*",
  "*clarity.ms*",
  "*bing.com/bat*",
  "*linkedin.com/px*",
  "*licdn.com*",
  "*taboola.com*",
  "*outbrain.com*",
  "*criteo.*",
  "*moengage.com*",
  "*sentry.io*",
  // Stock pictures some pages pull in (25 Nov: images.unsplash.com on a job page).
  "*images.unsplash.com*",
  "*cloudinary.com*",
  "*newrelic.com*",
  "*nr-data.net*",
];
const BY_SITE: Record<Site, string[]> = {
  // Naukri's picture hosts and its own log pings.
  naukri: ["*img.naukimg.com*", "*media.naukri.com*", "*videocdn.naukri.com*", "*logs.naukri.com*", "*logs.infoedgeindia.com*", "*lg.naukri.com*"],
  // From the K17 probe's own request list (27 Nov): Akamai's page-speed beacon (174 KB a page), Hirist's logs and audit
  // pings, its course ads and campaign banners, and iimjobs' billboard. Listings come from gladiator.hirist.tech, kept.
  hirist: ["*go-mpulse.net*", "*logs.hirist.tech*", "*audit-uba.hirist.tech*", "*lng-api.hirist.tech*", "*billboard.iimjobs.com*", "*hirist-assets.s3*"],
};
// Never dropped, whatever the patterns say: reCAPTCHA, which the site may show.
const NEVER = /^https:\/\/(www\.)?(google\.com|gstatic\.com|recaptcha\.net)\/recaptcha\//;

export function leanEnabled(env: Record<string, string | undefined> = process.env) {
  return env.SIGNED_IN_LEAN !== "0";
}

export function leanPatterns(site: Site) {
  return [...COMMON, ...BY_SITE[site]];
}

/** Whether Chrome drops this address in a lean window (the same wildcard rules as setBlockedURLs: `*` is anything). */
export function leanBlocks(site: Site, url: string) {
  if (NEVER.test(url)) return false;
  return leanPatterns(site).some((pattern) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i").test(url));
}

/** Sets lean pages on every page of a signed-in site's context, now and as pages open (popups included). */
export async function leanPages(context: BrowserContext, site: Site) {
  // reCAPTCHA's own addresses never end in a picture's file type, so the patterns leave it alone; checked in the test.
  const urls = leanPatterns(site);
  const apply = async (page: Page) => {
    try {
      const session = await context.newCDPSession(page);
      await session.send("Network.enable");
      await session.send("Network.setBlockedURLs", { urls });
    } catch {
      // A page that closed meanwhile: nothing to set.
    }
  };
  context.on("page", (page) => void apply(page));
  await Promise.all(context.pages().map(apply));
  return { patterns: urls.length };
}
