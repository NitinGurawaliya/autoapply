import { z } from "zod";
import { asDate, plainText, processHttp, type BoardHttp, type FetchedJob, type HttpReply } from "../normalize";

/**
 * Workday career sites (T99) through their public CXS API, the one the site's own page calls; no login. A company's
 * slug is `{tenant}.{wdN}/{site}` ("browserstack.wd3/External"): https://browserstack.wd3.myworkdayjobs.com/External.
 * Large tenants list thousands of jobs worldwide (NVIDIA 2,000), so the list is narrowed to the tenant's India location
 * facet when it has one, and only the first MAX_JOBS are read.
 */

const PAGE = 20; // the API refuses more
const MAX_JOBS = 400;
// Gently (owner, 18 Nov): from 17 Nov Workday's Cloudflare put this server's reads through a bot check (429,
// `cf-mitigated: challenge`) for 201 of 206 tenants. One request at a time with a second between them; a refused read
// is reported as refused (the company waits, it does not count as a failure: cadence.ts), never retried at once.
// Read from inside the stealthy Chrome (`options.http`, 23 Nov) the requests are the site's own page's; the pauses
// can then be the browser reader's (`pauseMs`).
const DETAIL_CONCURRENCY = 1;
const PAGE_PAUSE_MS = 1000;
const DETAIL_PAUSE_MS = 1000;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type WorkdayOptions = {
  /** False: the list alone (discovery). Default: each new posting's page too. */
  details?: boolean;
  /** Postings ingest already holds: proven still listed by the list alone, never read again. */
  known?: ReadonlySet<string>;
  /** The transport: the process's fetch, or the stealthy Chrome's (modules/apply/board-reader.ts). */
  http?: BoardHttp;
  /** Between two requests, in ms (default a second, the gentle rule). */
  pauseMs?: number;
};

/** Workday's Cloudflare refusing this server: a 429, or a 403 marked as its bot check. */
const refusal = (response: HttpReply) => response.status === 429 || (response.status === 403 && !!response.headers.get("cf-mitigated"));

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
  // A language first ("en-US", and "en-us" as some lists write it, 23 Nov: Intel and GSK): the site is the next part, and an
  // address that is only a language names no site (Workday answers it with its "Page not found").
  const site = /^[a-z]{2}-[a-z]{2}$/i.test(parts[0] ?? "") ? parts[1] : parts[0];
  if (!site || !/^[A-Za-z0-9_-]+$/.test(site) || /^(wday|job|details)$/i.test(site)) return null;
  return `${host[1]}.${host[2]}/${site}`;
}

const facetValue: z.ZodType<{ descriptor?: string; id?: string; facetParameter?: string; values?: unknown[] }> = z.object({
  descriptor: z.string().optional(),
  id: z.string().optional(),
  facetParameter: z.string().optional(),
  values: z.array(z.unknown()).optional(),
});
const postingSchema = z.object({ title: z.string(), externalPath: z.string(), locationsText: z.string().optional(), postedOn: z.string().optional(), bulletFields: z.array(z.string()).optional() });
// Since about 9 Nov 2026 some tenants' pages carry an empty posting ({}) among the real ones (16 of 132 tenants, e.g.
// fiserv.wd5/ext): a posting that does not parse is left out instead of failing the whole page.
const listSchema = z.object({
  total: z.number().optional(),
  facets: z.array(facetValue).optional(),
  jobPostings: z
    .array(z.unknown())
    .optional()
    .transform((items) => items?.flatMap((item) => {
      const parsed = postingSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })),
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

async function list(api: string, body: object, http: BoardHttp = processHttp) {
  const response = await http.fetch(`${api}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (refusal(response)) throw new Error(`workday ${api.split("/cxs/")[1]} ${response.status} refused${response.headers.get("cf-mitigated") ? " (bot check)" : ""}`);
  if (!response.ok) throw new Error(`workday ${api.split("/cxs/")[1]} ${response.status}`);
  return listSchema.parse(await response.json());
}

/**
 * Every open job on the site (India only when the tenant has an India facet). `details: false` (discovery) reads only
 * the list: titles, places and relative dates, one request a page; ingest reads each posting for its description.
 */
export async function fetchWorkday(slug: string, options: WorkdayOptions = {}): Promise<FetchedJob[]> {
  const site = parseWorkdaySlug(slug);
  if (!site) throw new Error(`workday ${slug}: not a {tenant}.{wdN}/{site} slug`);
  const http = options.http ?? processHttp;
  const pagePause = options.pauseMs ?? PAGE_PAUSE_MS;
  const detailPause = options.pauseMs ?? DETAIL_PAUSE_MS;
  const first = await list(site.api, { limit: PAGE, offset: 0, searchText: "", appliedFacets: {} }, http);
  const india = indiaFacet(first.facets ?? []);
  const appliedFacets = india ? { [india.parameter]: [india.id] } : {};
  const postings = india ? [] : [...(first.jobPostings ?? [])];
  let total = india ? Infinity : (first.total ?? postings.length);
  for (let offset = postings.length; offset < Math.min(total, MAX_JOBS); offset += PAGE) {
    const page = await list(site.api, { limit: PAGE, offset, searchText: "", appliedFacets }, http);
    if (total === Infinity) total = page.total ?? MAX_JOBS;
    const items = page.jobPostings ?? [];
    postings.push(...items);
    if (items.length < PAGE) break;
    await pause(pagePause);
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
  // Postings ingest already holds are proven still listed by the list alone (M2): no detail read, no rewrite.
  const known = options.known;
  const toRead = known ? postings.filter((posting) => !known.has(postingId(site.tenant, posting.externalPath))) : postings;
  if (known) {
    for (const posting of postings) {
      if (!known.has(postingId(site.tenant, posting.externalPath))) continue;
      const job = listed(posting);
      if (job) jobs.push({ ...job, listOnly: true });
    }
  }
  let next = 0;
  // Once a posting's page is refused, the rest are kept from the list alone instead of asking again.
  let refused = false;
  const worker = async () => {
    while (next < toRead.length) {
      const posting = toRead[next++];
      const response = refused ? null : await http.fetch(`${site.api}${posting.externalPath}`, { headers: { Accept: "application/json" } }).catch(() => null);
      if (response && refusal(response)) refused = true;
      const parsed = response?.ok ? detailSchema.safeParse(await response.json().catch(() => null)) : null;
      if (response) await pause(detailPause);
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
export async function workdayName(slug: string, http: BoardHttp = processHttp) {
  const site = parseWorkdaySlug(slug);
  if (!site) return null;
  const page = await list(site.api, { limit: 1, offset: 0, searchText: "", appliedFacets: {} }, http).catch(() => null);
  const path = page?.jobPostings?.[0]?.externalPath;
  if (!path) return null;
  const body = (await http.fetch(`${site.api}${path}`, { headers: { Accept: "application/json" } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { hiringOrganization?: { name?: unknown } } | null;
  const name = typeof body?.hiringOrganization?.name === "string" ? body.hiringOrganization.name : "";
  return name.replace(/\b(india\s+)?(private|pvt\.?)\s+(limited|ltd\.?)|\b(inc|llc|ltd|limited|corporation|corp)\.?$/gi, "").replace(/[\s,]+$/, "").trim() || null;
}
