import { z } from "zod";
import { asDate, plainText, type FetchedJob } from "../normalize";

/**
 * Zoho Recruit career portals (T99): `{company}.zohorecruit.in` (or .com, .eu) `/jobs/Careers`. Zoho has no public
 * JSON feed for a portal (its page makes no request for jobs): the public page carries every published opening as
 * JSON in a hidden `<input id="jobs">`, which is what is read here. A company's slug is the portal host
 * ("artingdigital.zohorecruit.in"); a portal not named "Careers" is written "host/Portal". An unknown host answers 200
 * "Page does not exist", with no jobs input: null, not a board.
 */

const HOST = /^[a-z0-9-]+\.zohorecruit\.(in|com|eu|com\.au|jp)$/;

export function parseZohoSlug(slug: string) {
  const [host, portal = "Careers"] = slug.split("/");
  if (!HOST.test(host) || !/^[A-Za-z0-9_-]+$/.test(portal)) return null;
  return { host, portal, url: `https://${host}/jobs/${portal}` };
}

/** The slug of a portal address ("https://artingdigital.zohorecruit.in/jobs/Careers/1074…/French-…"). */
export function zohoSlugOf(url: URL) {
  const host = url.hostname.toLowerCase();
  if (!HOST.test(host) || /^(www|help|alumni)\./.test(host)) return null;
  const portal = url.pathname.match(/^\/jobs\/([A-Za-z0-9_-]+)/)?.[1];
  return portal && portal !== "Careers" ? `${host}/${portal}` : host;
}

// Which fields a portal shows is the company's setting: a portal may leave out the date or the description.
const jobSchema = z.object({
  id: z.string(),
  Posting_Title: z.string().optional(),
  Job_Opening_Name: z.string().optional(),
  City: z.string().nullish(),
  State: z.string().nullish(),
  Country: z.string().nullish(),
  Remote_Job: z.boolean().nullish(),
  Job_Description: z.string().nullish(),
  Work_Experience: z.string().nullish(),
  Job_Type: z.string().nullish(),
  Date_Opened: z.string().nullish(),
  Publish: z.boolean().nullish(),
});

const unescape = (text: string) =>
  text
    .replace(/&#34;|&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** The portal page's openings and its title, or null when the host has no portal. */
export async function readZohoPortal(slug: string) {
  const portal = parseZohoSlug(slug);
  if (!portal) return null;
  const response = await fetch(portal.url, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`zohorecruit ${slug} ${response.status}`);
  const html = await response.text();
  const input = html.match(/<input\b[^>]*\bvalue="([^"]*)"[^>]*\bid="jobs"/) ?? html.match(/<input\b[^>]*\bid="jobs"[^>]*\bvalue="([^"]*)"/);
  if (!input) return null;
  const items = z.array(z.unknown()).parse(JSON.parse(unescape(input[1])));
  return { portal, items, title: unescape(html.match(/<title>([^<]{1,160})<\/title>/i)?.[1] ?? "").trim() };
}

/** Every published opening on the portal; one without an opening date is left out (we cannot tell how old it is). */
export async function fetchZohoRecruit(slug: string): Promise<FetchedJob[]> {
  const page = await readZohoPortal(slug);
  if (!page) throw new Error(`zohorecruit ${slug}: no portal`);
  const jobs: FetchedJob[] = [];
  for (const item of page.items) {
    const parsed = jobSchema.safeParse(item);
    if (!parsed.success || parsed.data.Publish === false) continue;
    const job = parsed.data;
    const title = (job.Posting_Title || job.Job_Opening_Name || "").trim();
    const postedAt = asDate(job.Date_Opened);
    if (!title || !postedAt) continue;
    const location = [job.City, job.State, job.Country].filter((part) => part?.trim()).join(", ");
    const remote = job.Remote_Job === true;
    // Experience is a field of its own ("1-3 years"): kept with the description so the tags read it.
    const description = plainText([job.Work_Experience ? `Experience: ${job.Work_Experience}` : "", job.Job_Description ?? ""].join(" "));
    jobs.push({
      externalId: `${page.portal.host}:${job.id}`,
      title,
      location: remote ? `Remote, ${location}`.replace(/, $/, "") : location,
      description,
      applyUrl: `${page.portal.url}/${job.id}/${title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      postedAt,
      isRemote: remote,
      raw: { id: job.id, title, location, remote, jobType: job.Job_Type ?? null, dateOpened: job.Date_Opened ?? null },
    });
  }
  return jobs;
}

/** The company's name from the portal's title ("Jobs at addMatrix", "Arting Digital Private Limited - …"). */
export async function zohoName(slug: string) {
  const page = await readZohoPortal(slug).catch(() => null);
  const name = page?.title.replace(/^(jobs|careers)\s+at\s+/i, "").replace(/\s+-\s+.*$/, "").replace(/\s+(careers|jobs)$/i, "");
  return name?.replace(/\b(private|pvt\.?)\s+(limited|ltd\.?)|\b(ltd|limited|inc|llc)\.?$/gi, "").replace(/[\s,]+$/, "").trim() || null;
}
