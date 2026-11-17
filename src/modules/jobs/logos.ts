import { db } from "@/lib/db";

// Company logos for the cards (24 Oct, owner: show who is hiring, not initials). Kept in Company.logoUrl as an https
// address; the image itself is never stored or proxied. A company without one is looked at again after RETRY_DAYS.
// 18 Nov (owner: every company on every board has a logo): first the company's own logo from its public board page
// (Greenhouse, Lever, Ashby, Keka, Workable, Zoho Recruit); else its website's icon, the website named by the board
// (Ashby) or found by its name (Clearbit's free name-to-domain suggest, accepted only when the domain is the company's
// own name or board slug), and the icon taken from Google's icon service, which answers 404 when a site has none.

const BOARD_PAGE: Record<string, (slug: string) => string> = {
  greenhouse: (slug) => `https://job-boards.greenhouse.io/${encodeURIComponent(slug)}`,
  lever: (slug) => `https://jobs.lever.co/${encodeURIComponent(slug)}`,
  ashby: (slug) => `https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`,
  // Keka's careers page is an empty shell; its portal settings (JSON) name the logo (1 Nov).
  keka: (slug) => `https://${encodeURIComponent(slug)}.keka.com/careers/api/organization/default/careerportalinfo`,
  // Workable and Zoho Recruit name the company logo as the page's og:image (18 Nov).
  workable: (slug) => `https://apply.workable.com/${encodeURIComponent(slug)}/`,
  zohorecruit: (slug) => `https://${slug.replace(/[^a-z0-9.-]/gi, "")}/jobs/Careers`,
};
// Every board we read jobs from: those without a board page (SmartRecruiters, Workday) get the website icon.
export const LOGO_SOURCES = [...Object.keys(BOARD_PAGE), "smartrecruiters", "workday"];
const RETRY_DAYS = 30;
const PAUSE_MS = 300;

const decode = (text: string) => text.replace(/&amp;/g, "&").replace(/\\u002F/gi, "/").trim();
const httpsOnly = (url: string | undefined) => (url && /^https:\/\/[^\s"'<>]+$/i.test(decode(url)) ? decode(url) : null);
const ogImage = (html: string) => html.match(/<meta[^>]+property\s*=\s*"og:image"[^>]+content\s*=\s*"([^"]+)"/i)?.[1] ?? html.match(/<meta[^>]+content\s*=\s*"([^"]+)"[^>]+property\s*=\s*"og:image"/i)?.[1];

/**
 * The logo address in a board page, or null. Greenhouse marks it `<img class="logo">`, Lever with "logo" in the alt
 * text, Ashby as `logoSquareImageUrl` in the page's data, Keka as `logoPath` in its portal settings, Workable and Zoho
 * Recruit as the og:image (their account logo). Lever's and Ashby's og:image is not used: it is a wide banner (24 Oct).
 */
export function logoFromHtml(source: string, html: string): string | null {
  // Keka: `logoPath` is relative to the tenant's documents folder, whose id is in `careersBackgroundPath`
  // ("/ats/documents/<id>/...") or, when that is empty, in the careers page appended after the JSON (fetchLogoUrl),
  // on the portal's own host (careersPortalDomain).
  if (source === "keka") {
    const logoPath = html.match(/"logoPath"\s*:\s*"([^"]+)"/)?.[1];
    const tenant = html.match(/\/ats\/documents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i)?.[1];
    const host = html.match(/"careersPortalDomain"\s*:\s*"([a-z0-9.-]+)"/i)?.[1];
    return logoPath && tenant && host ? httpsOnly(`https://${host}/ats/documents/${tenant}/${logoPath.replace(/^\/+/, "")}`) : null;
  }
  // Workable: the account's own logo ("workablehr.s3.amazonaws.com/uploads/account/..."), not Workable's default image.
  if (source === "workable") {
    const image = httpsOnly(ogImage(html));
    return image && /\/uploads\/account\//i.test(image) ? image : null;
  }
  // Zoho Recruit: the career site's company logo ("/recruit/viewCareerImage.do?...company_logo...").
  if (source === "zohorecruit") {
    const image = httpsOnly(ogImage(html)) ?? httpsOnly(html.match(/https:\/\/[^"'\s<>]*viewCareerImage\.do\?[^"'\s<>]*type=meta[^"'\s<>]*/i)?.[0]);
    return image && /viewCareerImage|logo/i.test(image) ? image : null;
  }
  // Ashby: the square logo, else the wordmark (wide, but it still names the company better than initials).
  if (source === "ashby") return httpsOnly(html.match(/"logoSquareImageUrl"\s*:\s*"([^"]+)"/)?.[1]) ?? httpsOnly(html.match(/"logoWordmarkImageUrl"\s*:\s*"([^"]+)"/)?.[1]);
  // Greenhouse keeps every board's logo in one folder of its CDN, often without the "logo" class (Addepar, Anthropic).
  if (source === "greenhouse") {
    const inFolder = html.match(/<img\b[^>]*\bsrc\s*=\s*"(https:\/\/[^"]*\/external_greenhouse_job_boards\/logos\/[^"]+)"/i)?.[1];
    if (inFolder) return httpsOnly(inFolder);
  }
  if (source !== "greenhouse" && source !== "lever") return null;
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const marked = source === "greenhouse" ? /\bclass\s*=\s*"[^"]*\blogo\b[^"]*"/i.test(tag) : /\balt\s*=\s*"[^"]*\blogo\b[^"]*"/i.test(tag);
    if (!marked) continue;
    const src = httpsOnly(tag.match(/\bsrc\s*=\s*"([^"]+)"/i)?.[1]);
    if (src) return src;
  }
  return null;
}

/** The company's own website named in its board page (Ashby's `publicWebsite`), as a bare host, or null. */
export function websiteFromHtml(source: string, html: string): string | null {
  const site = source === "ashby" ? html.match(/"publicWebsite"\s*:\s*"([^"]+)"/)?.[1] : undefined;
  return site ? hostOf(decode(site)) : null;
}

function hostOf(url: string) {
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A company name as people search for it: no leading codes ("0028 ", "IND ", "LE018 "), no bracketed parts, no legal
 * or regional suffixes ("Pte Ltd", "Private Limited", "India", "LLP"). Workday and Zoho names come like that.
 */
export function plainName(name: string) {
  return name
    .replace(/\([^)]*\)/g, " ")
    .replace(/^\s*(?:\d{2,6}|[A-Z]{1,3}\d{2,6}|\d[A-Z]\d|IND|USA|UK|SGP|MYS)\s*-?\s+(?=\S)/, "")
    .replace(/\b(jobs at|careers at)\b/gi, " ")
    .replace(/\b(private|pvt|pte|ltd|limited|llp|llc|inc|corp|corporation|co|company|gmbh|s\.?a\.?|b\.?v\.?|sdn|bhd|plc|ag|ulc|k\.?k\.?|technologies india|india|singapore|global tech center)\b\.?/gi, " ")
    .replace(/[,.&-]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The part of a board slug that names the company: Workday's tenant ("3m.wd1/Search" → 3m), Zoho's host label. */
export function slugKey(source: string, slug: string) {
  if (source === "workday" || source === "zohorecruit") return key(slug.split(/[./]/)[0]);
  return key(slug);
}

type Suggestion = { name?: string; domain?: string };

/**
 * The company's domain from its name: Clearbit's free suggest, accepted only when the domain's first label is the
 * company's own name or board slug ("hackerrank.com" for HackerRank, "3m.com" for Workday tenant 3m). A generic name
 * whose domain is something else is left without one: initials beat a stranger's logo.
 */
// The first two words of a long name, when specific enough ("Applied Materials" of "Applied Materials South East Asia").
const leadWords = (name: string) => {
  const words = plainName(name).split(" ");
  return words.length > 2 && key(words.slice(0, 2).join("")).length >= 8 ? words.slice(0, 2).join(" ") : "";
};

/**
 * The suggested domains that can be the company's: `sure` when the domain's first label is both its name and its board
 * slug ("swiggy.com" for Swiggy on smartrecruiters/Swiggy, "3m.com" for "IND 3M ..." on Workday tenant 3m); otherwise
 * one of the two only ("ahead.com" for AHEAD), which a short name shares with strangers: used only with evidence.
 */
export function domainCandidates(suggestions: Suggestion[], name: string, slug: string): Array<{ host: string; sure: boolean }> {
  const slugs = withStems([slug]);
  // A Workday company sometimes has only its slug for a name ("dxctechnology.wd1/dxcjobs"): its slug is its name.
  const names = /\/|\.wd\d/.test(name) ? slugs : withStems([key(plainName(name)), key(name), key(leadWords(name))]);
  const spaced = plainName(name).toLowerCase().replace(/\s+/g, "-");
  const out: Array<{ host: string; sure: boolean; owner: string }> = [];
  for (const suggestion of suggestions) {
    const host = suggestion.domain ? hostOf(suggestion.domain) : null;
    if (!host || out.some((item) => item.host === host)) continue;
    const raw = host.split(".")[0];
    // "bo-sch-group.de" is not Bosch Group's: a hyphenated domain counts only when the name is split the same way.
    if (raw.includes("-") && raw !== spaced) continue;
    const label = key(raw);
    const byName = names.has(label) || names.has(stem(label));
    const bySlug = slugs.has(label) || slugs.has(stem(label));
    // Sure only when Clearbit's own name for the domain is the company too ("Gradient Ventures" owns gradient.com),
    // or starts with it ("Eurofins Scientific" for eurofins.com).
    const owner = suggestion.name ? stem(key(suggestion.name)) : "";
    const named = owner !== "" && ([...withStems([key(suggestion.name ?? "")])].some((value) => names.has(value)) || owner.startsWith(label));
    if (byName || bySlug) out.push({ host, sure: byName && bySlug && named, owner });
  }
  // A name several unrelated owners answer to ("Gradient": gradient.com, gradient.co.me) is not sure of any of them.
  const owners = new Set(out.filter((item) => item.owner).map((item) => item.owner));
  const ambiguous = owners.size >= 2;
  return out.map(({ host, sure }) => ({ host, sure: sure && !ambiguous })).sort((a, b) => Number(b.sure) - Number(a.sure));
}

// Words that end company names and slugs without naming the company ("Bosch Group", "AccorHotel", "dxctechnology").
// Not "works", "ai", "io": those are domains as often as words (weekday.works, nightfall.ai); they become guesses below.
const GENERIC_TAIL = /(technologies|technology|tech|group|global|hotels|hotel|careers|jobs|labs|hq|solutions|software|systems|india|official|inc)$/;
const TLD_TAIL = /^(.{3,}?)(works|ai|io|app|co|tech|in)$/;
const stem = (value: string) => {
  const cut = value.replace(GENERIC_TAIL, "");
  return cut.length >= 3 ? cut : value;
};
const withStems = (values: string[]) => new Set(values.filter((value) => value.length >= 2).flatMap((value) => [value, stem(value)]));

/** Plain guesses at the company's domain from its name and slug ("capco.com"), used only with evidence. */
export function guessedDomains(name: string, slug: string): Suggestion[] {
  const labels = [...withStems([slug, key(plainName(name))])].filter((label) => label.length >= 3);
  // A slug that ends in a domain ending: "weekdayworks" → weekday.works, "nightfallai" → nightfall.ai.
  const tailed = labels.map((label) => label.match(TLD_TAIL)).filter((match): match is RegExpMatchArray => !!match).map((match) => ({ domain: `${match[1]}.${match[2]}` }));
  return [...tailed, ...labels.flatMap((label) => ["com", "in", "io", "ai", "co"].map((tld) => ({ domain: `${label}.${tld}` })))];
}

/**
 * The company's domain from its name (Clearbit's suggest): a sure one at once; one matching its name or slug only when
 * the company's own job posts mention it (`mentioned`: its website or email in a description or apply link).
 */
async function domainByName(name: string, slug: string, mentioned: (host: string) => Promise<boolean>): Promise<string | null> {
  const queries = [...new Set([plainName(name), leadWords(name), slug].filter((query) => query && query.length >= 2))];
  const found: Suggestion[] = [];
  for (const query of queries) {
    const suggestions = await fetch(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(10000) })
      .then((response) => (response.ok ? (response.json() as Promise<Suggestion[]>) : []))
      .catch(() => [] as Suggestion[]);
    if (Array.isArray(suggestions)) found.push(...suggestions);
  }
  // Clearbit does not know every company (Capco): plain guesses, checked against the company's own job posts.
  found.push(...guessedDomains(name, slug));
  for (const candidate of domainCandidates(found, name, slug)) {
    if (candidate.sure || (await mentioned(candidate.host))) return candidate.host;
  }
  return null;
}

/** Whether any of this company's jobs names the domain in its description or apply link. */
async function mentionedInJobs(source: string, slug: string, host: string) {
  const like = `%${host}%`;
  const rows = await db.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
    WHERE c.source = ${source} AND c.slug = ${slug} AND (j.description ILIKE ${like} OR j."applyUrl" ILIKE ${like})
    LIMIT 1`.catch(() => []);
  return rows.length > 0;
}

/** A website's icon (its apple-touch or favicon, 128 px) from Google's icon service; null when the site has none. */
async function siteIcon(domain: string): Promise<string | null> {
  const url = `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=128`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) }).catch(() => null);
  return response?.ok && /^image\//.test(response.headers.get("content-type") ?? "") ? url : null;
}

/**
 * One company's logo address: its own logo from its board page, else its website's icon (the website from the board
 * page, else from its name); null when neither is found or the pages did not load.
 */
export async function fetchLogoUrl(source: string, slug: string, name?: string): Promise<string | null> {
  const page = BOARD_PAGE[source];
  const read = (url: string) =>
    fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: "text/html", "user-agent": "Mozilla/5.0" } })
      .then((response) => (response.ok ? response.text() : ""))
      .catch(() => "");
  let html = page ? await read(page(slug)) : "";
  let logo = html ? logoFromHtml(source, html) : null;
  // A Keka portal with a logo but no background image names its documents folder only in the careers page.
  if (!logo && source === "keka" && /"logoPath"\s*:\s*"[^"]+"/.test(html)) {
    html += await read(`https://${encodeURIComponent(slug)}.keka.com/careers/`);
    logo = logoFromHtml(source, html);
  }
  if (logo) return logo;
  const domain = (html && websiteFromHtml(source, html)) || (name ? await domainByName(name, slugKey(source, slug), (host) => mentionedInJobs(source, slug, host)) : null);
  return domain ? siteIcon(domain) : null;
}

export type LogoRefresh = { checked: number; found: number; missing: number; examples: string[] };

/**
 * Logos for companies that have none yet and were not looked at in the last RETRY_DAYS (`again`: whatever their last
 * look), companies with India jobs first (they are on the cards), then oldest look first. A dry run reads and counts;
 * `write` saves each result (found or not, so it is not read again soon).
 */
export async function refreshLogos(options: { limit: number; write: boolean; sources?: string[]; again?: boolean; log?: (line: string) => void }): Promise<LogoRefresh> {
  const sources = (options.sources ?? LOGO_SOURCES).filter((source) => LOGO_SOURCES.includes(source));
  const retryDays = options.again ? 0 : RETRY_DAYS;
  const due = await db.$queryRaw<Array<{ id: string; source: string; slug: string; name: string }>>`
    SELECT id, source, slug, name FROM "Company"
    WHERE active AND source = ANY(${sources}::text[]) AND "logoUrl" IS NULL
      AND ("logoCheckedAt" IS NULL OR "logoCheckedAt" < now() - (${retryDays}::int * interval '1 day'))
    ORDER BY ("indiaOpen" > 0) DESC, "logoCheckedAt" ASC NULLS FIRST, name ASC
    LIMIT ${options.limit}`;
  const result: LogoRefresh = { checked: 0, found: 0, missing: 0, examples: [] };
  for (const company of due) {
    const logoUrl = await fetchLogoUrl(company.source, company.slug, company.name).catch(() => null);
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
