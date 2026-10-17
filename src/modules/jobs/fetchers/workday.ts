import { z } from "zod";
import { asDate, plainText, type FetchedJob } from "../normalize";

/**
 * Workday career sites (T99) through their public CXS API, the one the site's own page calls; no login. A company's
 * slug is `{tenant}.{wdN}/{site}` ("browserstack.wd3/External"): https://browserstack.wd3.myworkdayjobs.com/External.
 * Large tenants list thousands of jobs worldwide (NVIDIA 2,000), so the list is narrowed to the tenant's India location
 * facet when it has one, and only the first MAX_JOBS are read.
 */

const PAGE = 20; // the API refuses more
const MAX_JOBS = 400;
const DETAIL_CONCURRENCY = 4;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SLUG = /^([a-z0-9-]+)\.(wd\d{1,3})\/([A-Za-z0-9_-]+)$/;

export function parseWorkdaySlug(slug: string) {
  const match = slug.match(SLUG);
  if (!match) return null;
  const [, tenant, wd, site] = match;
  const origin = `https://${tenant}.${wd}.myworkdayjobs.com`;
  return { tenant, wd, site, origin, api: `${origin}/wday/cxs/${tenant}/${site}` };
}

/** The slug of a career-site address ("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/…"). */
export function workdaySlugOf(url: URL) {
  const host = url.hostname.toLowerCase().match(/^([a-z0-9-]+)\.(wd\d{1,3})\.myworkdayjobs\.com$/);
  if (!host) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const site = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] ?? "") ? parts[1] : parts[0];
  if (!site || !/^[A-Za-z0-9_-]+$/.test(site) || /^(wday|job|details)$/i.test(site)) return null;
  return `${host[1]}.${host[2]}/${site}`;
}

const facetValue: z.ZodType<{ descriptor?: string; id?: string; facetParameter?: string; values?: unknown[] }> = z.object({
  descriptor: z.string().optional(),
  id: z.string().optional(),
  facetParameter: z.string().optional(),
  values: z.array(z.unknown()).optional(),
});
const listSchema = z.object({
  total: z.number().optional(),
  facets: z.array(facetValue).optional(),
  jobPostings: z.array(z.object({ title: z.string(), externalPath: z.string(), locationsText: z.string().optional(), postedOn: z.string().optional(), bulletFields: z.array(z.string()).optional() })).optional(),
});
const detailSchema = z.object({
  jobPostingInfo: z.object({
    id: z.string(),
    title: z.string(),
    jobDescription: z.string().optional(),
    location: z.string().optional(),
    additionalLocations: z.array(z.string()).optional(),
    startDate: z.string().optional(),
    postedOn: z.string().optional(),
    remoteType: z.string().optional(),
    externalUrl: z.string().optional(),
  }),
});

/** The India value of the tenant's location facets ("locationCountry", "locationHierarchy1", …), or null. */
function indiaFacet(facets: z.infer<typeof facetValue>[], parameter?: string): { parameter: string; id: string } | null {
  for (const facet of facets) {
    const name = facet.facetParameter ?? parameter;
    if (facet.id && name && /^india$/i.test(facet.descriptor?.trim() ?? "") && /location|country/i.test(name)) return { parameter: name, id: facet.id };
    const nested = (facet.values ?? []).flatMap((value) => {
      const parsed = facetValue.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    });
    const found = indiaFacet(nested, name);
    if (found) return found;
  }
  return null;
}

/** "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago": the day, at 00:00 UTC. */
export function postedOnDate(text: string | undefined, now = new Date()) {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (!text) return null;
  if (/today/i.test(text)) return new Date(day);
  if (/yesterday/i.test(text)) return new Date(day - 86400000);
  const days = text.match(/(\d+)\+?\s*days?\s*ago/i);
  return days ? new Date(day - (Number(days[1]) + (text.includes("+") ? 1 : 0)) * 86400000) : null;
}

/** The posting's id on the site ("Business-Development-Representative_JR103711"), with the tenant: ids of two companies never meet. */
const postingId = (tenant: string, externalPath: string) => `${tenant}:${externalPath.split("/").pop()}`;

async function list(api: string, body: object) {
  const response = await fetch(`${api}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`workday ${api.split("/cxs/")[1]} ${response.status}`);
  return listSchema.parse(await response.json());
}

/**
 * Every open job on the site (India only when the tenant has an India facet). `details: false` (discovery) reads only
 * the list: titles, places and relative dates, one request a page; ingest reads each posting for its description.
 */
export async function fetchWorkday(slug: string, options: { details?: boolean } = {}): Promise<FetchedJob[]> {
  const site = parseWorkdaySlug(slug);
  if (!site) throw new Error(`workday ${slug}: not a {tenant}.{wdN}/{site} slug`);
  const first = await list(site.api, { limit: PAGE, offset: 0, searchText: "", appliedFacets: {} });
  const india = indiaFacet(first.facets ?? []);
  const appliedFacets = india ? { [india.parameter]: [india.id] } : {};
  const postings = india ? [] : [...(first.jobPostings ?? [])];
  let total = india ? Infinity : (first.total ?? postings.length);
  for (let offset = postings.length; offset < Math.min(total, MAX_JOBS); offset += PAGE) {
    const page = await list(site.api, { limit: PAGE, offset, searchText: "", appliedFacets });
    if (total === Infinity) total = page.total ?? MAX_JOBS;
    const items = page.jobPostings ?? [];
    postings.push(...items);
    if (items.length < PAGE) break;
    await pause(200);
  }
  const listed = (posting: (typeof postings)[number]): FetchedJob | null => {
    const postedAt = postedOnDate(posting.postedOn);
    if (!postedAt) return null;
    // "2 Locations" says nothing: the first place is in the path ("/job/India---Haryana---Gurgaon/…").
    const first = decodeURIComponent(posting.externalPath.split("/")[2] ?? "").replace(/-+/g, " ").trim();
    const location = /^\d+ locations?$/i.test(posting.locationsText ?? "") || !posting.locationsText ? first : posting.locationsText;
    return {
      externalId: postingId(site.tenant, posting.externalPath),
      title: posting.title,
      location,
      description: "",
      applyUrl: `${site.origin}/${site.site}${posting.externalPath}`,
      postedAt,
      isRemote: /remote/i.test(location),
      offices: india ? ["India"] : undefined,
      raw: { externalPath: posting.externalPath, locationsText: posting.locationsText ?? null, postedOn: posting.postedOn ?? null },
    };
  };
  if (options.details === false) return postings.map(listed).filter((job): job is FetchedJob => !!job);

  const jobs: FetchedJob[] = [];
  let next = 0;
  const worker = async () => {
    while (next < postings.length) {
      const posting = postings[next++];
      const response = await fetch(`${site.api}${posting.externalPath}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) }).catch(() => null);
      const parsed = response?.ok ? detailSchema.safeParse(await response.json().catch(() => null)) : null;
      await pause(150);
      if (!parsed?.success) {
        // A posting whose page fails is kept from the list alone rather than closed.
        const fallback = listed(posting);
        if (fallback) jobs.push(fallback);
        continue;
      }
      const info = parsed.data.jobPostingInfo;
      const postedAt = asDate(info.startDate) ?? postedOnDate(info.postedOn ?? posting.postedOn);
      if (!postedAt) continue;
      const location = [info.location, ...(info.additionalLocations ?? [])].filter(Boolean).join("; ");
      jobs.push({
        externalId: postingId(site.tenant, posting.externalPath),
        title: info.title,
        location,
        description: plainText(info.jobDescription ?? ""),
        applyUrl: info.externalUrl ?? `${site.origin}/${site.site}${posting.externalPath}`,
        postedAt,
        isRemote: /remote/i.test(info.remoteType ?? "") || /remote/i.test(location),
        raw: { id: info.id, externalPath: posting.externalPath, location, startDate: info.startDate ?? null, remoteType: info.remoteType ?? null },
      });
    }
  };
  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));
  return jobs;
}

/** The company's name for a site: the hiring organisation of its first posting, without "Private Limited" and the like. */
export async function workdayName(slug: string) {
  const site = parseWorkdaySlug(slug);
  if (!site) return null;
  const page = await list(site.api, { limit: 1, offset: 0, searchText: "", appliedFacets: {} }).catch(() => null);
  const path = page?.jobPostings?.[0]?.externalPath;
  if (!path) return null;
  const body = (await fetch(`${site.api}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { hiringOrganization?: { name?: unknown } } | null;
  const name = typeof body?.hiringOrganization?.name === "string" ? body.hiringOrganization.name : "";
  return name.replace(/\b(india\s+)?(private|pvt\.?)\s+(limited|ltd\.?)|\b(inc|llc|ltd|limited|corporation|corp)\.?$/gi, "").replace(/[\s,]+$/, "").trim() || null;
}
