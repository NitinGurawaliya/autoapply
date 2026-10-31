import { z } from "zod";
import { asDate, plainText, type FetchedJob } from "../normalize";

/**
 * Keka career portals (T96): `{company}.keka.com/careers`. Keka is an Indian HR suite many Indian startups use. Its
 * careers page loads every open job from `/careers/api/jobs/default/active` (no id, no paging; the page's own
 * app.min.js reads the same list), so a company's slug is just its subdomain ("jupiter"). An unknown subdomain redirects
 * to `/careers/Content/TenantNotFound.html` with status 200: null, not a board. robots.txt allows `/careers` only, and
 * everything here is under it.
 */

const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{0,62}$/;
// Keka's own hosts, not companies.
const NOT_A_COMPANY = new Set(["www", "app", "help", "api", "cdn", "status", "blog", "community", "developers", "login", "signup"]);

export const kekaBase = (slug: string) => `https://${slug}.keka.com/careers`;

/** The subdomain of a Keka address ("https://jupiter.keka.com/careers/jobdetails/145340" → "jupiter"), or null. */
export function kekaSlugOf(url: URL) {
  const host = url.hostname.toLowerCase();
  const match = host.match(/^([a-z0-9-]+)\.keka\.com$/);
  if (!match || NOT_A_COMPANY.has(match[1])) return null;
  return url.pathname.toLowerCase().startsWith("/careers") ? match[1] : null;
}

const jobSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().nullish(),
  departmentName: z.string().nullish(),
  jobLocations: z.array(z.object({ name: z.string().nullish(), city: z.string().nullish(), state: z.string().nullish(), countryName: z.string().nullish(), countryCode: z.string().nullish() })).nullish(),
  // 1 part time, 2 full time; others (internship, contract) by tenant.
  jobType: z.number().nullish(),
  experience: z.string().nullish(),
  publishedOn: z.string().nullish(),
});

/** The portal's open jobs as Keka returns them, or null when the subdomain has no Keka portal. */
async function readJobs(slug: string): Promise<unknown[] | null> {
  if (!SUBDOMAIN.test(slug) || NOT_A_COMPANY.has(slug)) return null;
  const response = await fetch(`${kekaBase(slug)}/api/jobs/default/active`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (/TenantNotFound/i.test(response.url)) return null;
  if (!response.ok) throw new Error(`keka ${slug} ${response.status}`);
  const body = await response.text();
  // A tenant whose portal is switched off answers an HTML page, not a list.
  if (!body.trimStart().startsWith("[")) return null;
  return z.array(z.unknown()).parse(JSON.parse(body));
}

/** Every open job on the company's Keka portal. */
export async function fetchKeka(slug: string): Promise<FetchedJob[]> {
  const items = await readJobs(slug);
  if (!items) throw new Error(`keka ${slug}: no portal`);
  const jobs: FetchedJob[] = [];
  for (const item of items) {
    const parsed = jobSchema.safeParse(item);
    if (!parsed.success) continue;
    const job = parsed.data;
    const postedAt = asDate(job.publishedOn);
    if (!job.title.trim() || !postedAt) continue;
    // A job may list several offices; each "City, State, Country", joined. Keka has no remote flag: a remote job says so
    // in its location's name ("Remote") or not at all.
    const places = (job.jobLocations ?? []).map((place) => [place.city, place.state, place.countryName].filter((part) => part?.trim()).join(", ") || place.name?.trim() || "").filter(Boolean);
    const location = [...new Set(places)].join("; ");
    const remote = (job.jobLocations ?? []).some((place) => /\bremote\b/i.test(place.name ?? ""));
    // Experience is a field of its own ("5-6 Years"): kept with the description so the tags read it.
    const description = plainText([job.experience ? `Experience: ${job.experience}` : "", job.description ?? ""].join(" "));
    jobs.push({
      externalId: `${slug}:${job.id}`,
      title: job.title.trim(),
      location: remote && !/remote/i.test(location) ? `Remote, ${location}`.replace(/, $/, "") : location,
      description,
      applyUrl: `${kekaBase(slug)}/jobdetails/${job.id}`,
      postedAt,
      isRemote: remote,
      raw: { id: job.id, title: job.title, location, department: job.departmentName ?? null, jobType: job.jobType ?? null, experience: job.experience ?? null, publishedOn: job.publishedOn ?? null },
    });
  }
  return jobs;
}

/** The company's name from its portal settings ("Jupiter Money"), or null. */
export async function kekaName(slug: string) {
  if (!SUBDOMAIN.test(slug)) return null;
  const response = await fetch(`${kekaBase(slug)}/api/organization/default/careerportalinfo`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!response?.ok || /TenantNotFound/i.test(response.url)) return null;
  const body = (await response.json().catch(() => null)) as { name?: unknown; shortName?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name : typeof body?.shortName === "string" ? body.shortName : "";
  return name.replace(/\b(private|pvt\.?)\s+(limited|ltd\.?)|\b(ltd|limited|inc|llc)\.?$/gi, "").replace(/[\s,]+$/, "").trim() || null;
}
