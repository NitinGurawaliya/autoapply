import { db } from "@/lib/db";

// Company logos for the cards (24 Oct, owner: show who is hiring, not initials). Read once from the company's own public
// job board page, the same page discovery reads for its name, and kept in Company.logoUrl; a company without one is
// looked at again after RETRY_DAYS. Only an https address is kept; the image itself is never stored or proxied.
// Workday and Zoho pages are left out: their jobs are not in the feed.

const BOARD_PAGE: Record<string, (slug: string) => string> = {
  greenhouse: (slug) => `https://job-boards.greenhouse.io/${encodeURIComponent(slug)}`,
  lever: (slug) => `https://jobs.lever.co/${encodeURIComponent(slug)}`,
  ashby: (slug) => `https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`,
};
export const LOGO_SOURCES = Object.keys(BOARD_PAGE);
const RETRY_DAYS = 30;
const PAUSE_MS = 1000;

const decode = (text: string) => text.replace(/&amp;/g, "&").replace(/\\u002F/gi, "/").trim();
const httpsOnly = (url: string | undefined) => (url && /^https:\/\/[^\s"'<>]+$/i.test(decode(url)) ? decode(url) : null);

/**
 * The logo address in a board page, or null. Greenhouse marks it `<img class="logo">`, Lever with "logo" in the alt
 * text, Ashby as `logoSquareImageUrl` in the page's data. The page's social image (`og:image`) is not used: it is a wide
 * banner on Lever and Ashby (24 Oct).
 */
export function logoFromHtml(source: string, html: string): string | null {
  // Ashby: the square logo, else the wordmark (wide, but it still names the company better than initials).
  if (source === "ashby") return httpsOnly(html.match(/"logoSquareImageUrl"\s*:\s*"([^"]+)"/)?.[1]) ?? httpsOnly(html.match(/"logoWordmarkImageUrl"\s*:\s*"([^"]+)"/)?.[1]);
  // Greenhouse keeps every board's logo in one folder of its CDN, often without the "logo" class (Addepar, Anthropic).
  if (source === "greenhouse") {
    const inFolder = html.match(/<img\b[^>]*\bsrc\s*=\s*"(https:\/\/[^"]*\/external_greenhouse_job_boards\/logos\/[^"]+)"/i)?.[1];
    if (inFolder) return httpsOnly(inFolder);
  }
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const marked = source === "greenhouse" ? /\bclass\s*=\s*"[^"]*\blogo\b[^"]*"/i.test(tag) : /\balt\s*=\s*"[^"]*\blogo\b[^"]*"/i.test(tag);
    if (!marked) continue;
    const src = httpsOnly(tag.match(/\bsrc\s*=\s*"([^"]+)"/i)?.[1]);
    if (src) return src;
  }
  return null;
}

/** Reads one company's board page and returns its logo address (null when it has none or the page did not load). */
export async function fetchLogoUrl(source: string, slug: string): Promise<string | null> {
  const page = BOARD_PAGE[source];
  if (!page) return null;
  const html = await fetch(page(slug), { signal: AbortSignal.timeout(15000), headers: { accept: "text/html" } })
    .then((response) => (response.ok ? response.text() : ""))
    .catch(() => "");
  return html ? logoFromHtml(source, html) : null;
}

export type LogoRefresh = { checked: number; found: number; missing: number; examples: string[] };

/**
 * Logos for companies that have none yet and were not looked at in the last RETRY_DAYS, oldest first, one page a
 * second. A dry run reads the pages and counts; `write` saves each result (found or not, so it is not read again soon).
 */
export async function refreshLogos(options: { limit: number; write: boolean; sources?: string[]; log?: (line: string) => void }): Promise<LogoRefresh> {
  const sources = (options.sources ?? LOGO_SOURCES).filter((source) => LOGO_SOURCES.includes(source));
  const due = await db.$queryRaw<Array<{ id: string; source: string; slug: string; name: string }>>`
    SELECT id, source, slug, name FROM "Company"
    WHERE active AND source = ANY(${sources}::text[]) AND "logoUrl" IS NULL
      AND ("logoCheckedAt" IS NULL OR "logoCheckedAt" < now() - (${RETRY_DAYS}::int * interval '1 day'))
    ORDER BY "logoCheckedAt" ASC NULLS FIRST, name ASC
    LIMIT ${options.limit}`;
  const result: LogoRefresh = { checked: 0, found: 0, missing: 0, examples: [] };
  for (const company of due) {
    const logoUrl = await fetchLogoUrl(company.source, company.slug);
    result.checked += 1;
    if (logoUrl) {
      result.found += 1;
      if (result.examples.length < 5) result.examples.push(`${company.name}: ${logoUrl.slice(0, 90)}`);
    } else {
      result.missing += 1;
      options.log?.(`logos: none for ${company.name} (${company.source}/${company.slug})`);
    }
    if (options.write) await db.$executeRaw`UPDATE "Company" SET "logoUrl" = ${logoUrl}, "logoCheckedAt" = now() WHERE id = ${company.id}`;
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
  return result;
}
