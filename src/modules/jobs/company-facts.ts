import { db } from "@/lib/db";
import { SITES } from "@/modules/sources/sites";
import { boardFromUrl } from "./boardSeeds";
import { employerDomain, isGenericCompanyName } from "./domains";
import { BOARD_PAGE, domainByName, jobHosts, LOGO_SOURCES, mentionedInJobs, ownSiteOf, slugKey } from "./logos";

// What a board account says about its company: its own website and its name (Phase W, docs/employers/TDD.md 4.4 and
// 4.5). One read of the board's public page, the same address logos.ts reads, so the logo sweep and this one see the
// same page. The extractors are pure; fetchCompanyFacts and refreshCompanyFacts do the reading and the writing.

export type DomainBasis = "board" | "redirect" | "job_links" | "name_evidence" | "owner";

const PAUSE_MS = 300;
const SITE_SOURCES: readonly string[] = SITES;

const decodeEntities = (text: string) =>
  text.replace(/&quot;/g, '"').replace(/&#0?34;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2F;|&#47;/g, "/").replace(/&amp;/g, "&");
const clean = (text: string | undefined | null) => {
  const value = decodeEntities((text ?? "").replace(/\\u002F/gi, "/")).replace(/\s+/g, " ").trim();
  return value || null;
};
const json = (page: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(page.slice(page.indexOf("{")));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const text = (value: unknown) => (typeof value === "string" ? clean(value) : null);

/**
 * The company's own website as its board's page names it (raw, for employerDomain to judge), or null.
 * Ashby `publicWebsite`; Workable and Keka account JSON (`url`, `companyWebsite`); Lever's footer "Home Page" link (the
 * header logo link is the jobs page); SmartRecruiters' job-page header logo link; Zoho Recruit `org_info.website`
 * (unless the portal hides it); Greenhouse's `logo.href` when the company set one. Workday names none.
 */
export function websiteFromBoardPage(source: string, page: string): string | null {
  if (source === "ashby") return clean(page.match(/"publicWebsite"\s*:\s*"([^"]+)"/)?.[1]);
  if (source === "workable") return text(json(page)?.url) ?? clean(page.match(/"url"\s*:\s*"(https?:[^"]+)"/)?.[1]);
  if (source === "keka") return text(json(page)?.companyWebsite) ?? clean(page.match(/"companyWebsite"\s*:\s*"([^"]+)"/)?.[1]);
  if (source === "lever") return clean(page.match(/<div[^>]*class="main-footer-text"[^>]*>\s*<p>\s*<a[^>]+href="([^"]+)"/i)?.[1]);
  if (source === "smartrecruiters") return clean(page.match(/class="[^"]*header-logo[^"]*"[\s\S]{0,400}?<a[^>]+href="([^"]+)"/i)?.[1]);
  if (source === "greenhouse") return clean(page.match(/"logo"\s*:\s*\{[^}]*?"href"\s*:\s*"([^"]+)"/)?.[1]);
  if (source === "zohorecruit") {
    const decoded = decodeEntities(page);
    if (/"hide_visit_website"\s*:\s*true/.test(decoded)) return null;
    return clean(decoded.match(/"website"\s*:\s*"([^"]+)"/)?.[1]);
  }
  return null;
}

/**
 * The company's own name as its board's page gives it, or null: Workable and Keka account JSON, Lever's footer link
 * ("CRED Home Page") or page title, SmartRecruiters' header link title, Zoho Recruit's `org_info.company_name` or
 * og:site_name (unless the portal hides the name).
 */
export function nameFromBoardPage(source: string, page: string): string | null {
  if (source === "workable" || source === "keka") return text(json(page)?.name);
  if (source === "lever") {
    const link = page.match(/<div[^>]*class="main-footer-text"[^>]*>\s*<p>\s*<a[^>]*>([^<]+)<\/a>/i)?.[1];
    const fromLink = clean(link)?.replace(/\s*home page$/i, "").trim();
    return fromLink || clean(page.match(/<title>([^<]+)<\/title>/i)?.[1]);
  }
  if (source === "smartrecruiters") return clean(page.match(/class="[^"]*header-logo[^"]*"[\s\S]{0,400}?<a[^>]*\btitle="([^"]+)"/i)?.[1]);
  if (source === "zohorecruit") {
    const decoded = decodeEntities(page);
    if (/"hide_company_name"\s*:\s*true/.test(decoded)) return null;
    return clean(decoded.match(/"company_name"\s*:\s*"([^"]+)"/)?.[1]) ?? clean(page.match(/<meta[^>]+property\s*=\s*"og:site_name"[^>]+content\s*=\s*"([^"]+)"/i)?.[1]);
  }
  return null;
}

const read = (url: string) =>
  fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: "text/html,application/json;q=0.9,*/*;q=0.8", "user-agent": "Mozilla/5.0" } })
    .then((response) => (response.ok ? response.text() : ""))
    .catch(() => "");

/** The board page that names the company: logos.ts's address, and for SmartRecruiters the newest job's page. */
async function readBoardPage(source: string, slug: string): Promise<string> {
  if (source === "smartrecruiters") {
    const posting = (await read(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=1`)).match(/"content"\s*:\s*\[\s*\{\s*"id"\s*:\s*"(\d+)"/)?.[1];
    return posting ? read(`https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${posting}`) : "";
  }
  const address = BOARD_PAGE[source];
  return address ? read(address(slug)) : "";
}

/**
 * A signed-in listing's company, by the board its jobs send people to: a Naukri job whose apply link is a Greenhouse,
 * Lever or Ashby board we read takes that board account's domain (TDD 4.7). Null when none does.
 */
export async function redirectDomain(companyId: string): Promise<string | null> {
  const jobs = await db.$queryRaw<Array<{ applyUrl: string }>>`SELECT "applyUrl" FROM "Job" WHERE "companyId" = ${companyId} AND "applyVia" IS NOT NULL LIMIT 5`;
  for (const job of jobs) {
    const board = boardFromUrl(job.applyUrl);
    if (!board) continue;
    const target = await db.company.findUnique({ where: { source_slug: { source: board.source, slug: board.slug } }, select: { domain: true } });
    if (target?.domain) return target.domain;
  }
  return null;
}

export type CompanyFacts = { domain: string | null; basis: DomainBasis | null; name: string | null };

/**
 * One company's website domain and name, with the evidence, in the order of TDD 4.4: its board's own field, then (a
 * signed-in listing) the board its jobs redirect to, then the host its job links point to, then the domain its name
 * suggests with proof in its own postings. Never throws for a page that did not load: that is "nothing found".
 */
export async function fetchCompanyFacts(company: { id: string; source: string; slug: string; name: string }): Promise<CompanyFacts> {
  const signedIn = SITE_SOURCES.includes(company.source);
  if (signedIn) {
    const domain = await redirectDomain(company.id).catch(() => null);
    return { domain, basis: domain ? "redirect" : null, name: null };
  }
  const page = await readBoardPage(company.source, company.slug);
  const name = page ? nameFromBoardPage(company.source, page) : null;
  const fromBoard = page ? employerDomain(websiteFromBoardPage(company.source, page)) : null;
  if (fromBoard) return { domain: fromBoard, basis: "board", name };
  const key = slugKey(company.source, company.slug);
  const fromLinks = employerDomain(ownSiteOf(await jobHosts(company.source, company.slug).catch(() => []), company.name, key));
  if (fromLinks) return { domain: fromLinks, basis: "job_links", name };
  const byName = await domainByName(company.name, key, (host) => mentionedInJobs(company.source, company.slug, host)).catch(() => null);
  const fromName = employerDomain(byName);
  return { domain: fromName, basis: fromName ? "name_evidence" : null, name };
}

export type FactsRefresh = { checked: number; withDomain: number; renamed: number };

/**
 * The facts of companies (switched-off boards too: a company may come back, and its domain still joins it to its employer) not looked at yet, or looked at and found nothing 30 days ago, or found 180 days ago; rows with
 * an owner domain never. India-hiring and listing companies first (they are the pages), then the longest unlooked. A dry
 * run reads and counts; `write` saves each result (found or not, so it is not read again soon). A lookup that finds
 * nothing keeps the domain the row already had.
 */
export async function refreshCompanyFacts(options: { limit: number; write: boolean; sources?: string[]; pauseMs?: number; shard?: { of: number; index: number }; log?: (line: string) => void }): Promise<FactsRefresh> {
  const sources = (options.sources ?? [...LOGO_SOURCES, ...SITES]).filter((source) => LOGO_SOURCES.includes(source) || SITE_SOURCES.includes(source));
  // A shard is a share of the rows by id, so several sweeps can work one board at once without taking the same rows.
  const shardOf = options.shard?.of ?? 1;
  const shardAt = options.shard?.index ?? 0;
  const due = await db.$queryRaw<Array<{ id: string; source: string; slug: string; name: string; domain: string | null; domainBasis: string | null }>>`
    SELECT id, source, slug, name, domain, "domainBasis" FROM "Company"
    WHERE source = ANY(${sources}::text[]) AND "domainBasis" IS DISTINCT FROM 'owner'
      AND (${shardOf}::bigint <= 1 OR mod(hashtext(id)::bigint & 2147483647, ${shardOf}::bigint) = ${shardAt}::bigint)
      AND ("domainCheckedAt" IS NULL
           OR (domain IS NULL AND "domainCheckedAt" < now() - interval '30 days')
           OR "domainCheckedAt" < now() - interval '180 days')
    ORDER BY (source = ANY(${[...SITES]}::text[])) ASC, ("indiaOpen" > 0) DESC, (coalesce("lastFetchCount", 0) > 0) DESC, "domainCheckedAt" ASC NULLS FIRST
    LIMIT ${options.limit}`;
  const result: FactsRefresh = { checked: 0, withDomain: 0, renamed: 0 };
  for (const company of due) {
    const facts = await fetchCompanyFacts(company).catch(() => ({ domain: null, basis: null, name: null }) as CompanyFacts);
    result.checked += 1;
    const domain = facts.domain ?? company.domain;
    const basis = facts.domain ? facts.basis : company.domainBasis;
    if (domain) result.withDomain += 1;
    else options.log?.(`facts: no domain for ${company.name} (${company.source}/${company.slug})`);
    const rename = isGenericCompanyName(company.name) && facts.name && !isGenericCompanyName(facts.name) ? facts.name : null;
    if (rename) result.renamed += 1;
    if (options.write) {
      // A signed-in listing's only evidence is a board row that may not have been looked at yet: with nothing found it
      // is due again in a day (stamped 29 days back), not in 30.
      const retrySoon = !domain && SITE_SOURCES.includes(company.source);
      await db.$executeRaw`UPDATE "Company" SET domain = ${domain}, "domainBasis" = ${basis}, "domainCheckedAt" = now() - (${retrySoon ? 29 : 0}::int * interval '1 day'), name = coalesce(${rename}, name) WHERE id = ${company.id}`;
    }
    await new Promise((resolve) => setTimeout(resolve, options.pauseMs ?? PAUSE_MS));
  }
  return result;
}
