import { z } from "zod";
import { asDate, plainText, type FetchedJob } from "../normalize";

/**
 * Workable (Phase M, M12): the public widget API, no sign-in, one request a company with every open job and its
 * description (`details=true`). `Company.slug` is the account in its addresses (apply.workable.com/<slug>). An unknown
 * account answers 404; an account with no openings an empty list. Indian employers on it: Apna, Zifo, Lokal.
 */

const API = "https://apply.workable.com/api/v1/widget/accounts";

const locationSchema = z.object({
  country: z.string().nullish(),
  countryCode: z.string().nullish(),
  city: z.string().nullish(),
  region: z.string().nullish(),
  hidden: z.boolean().nullish(),
});
const jobSchema = z.object({
  title: z.string(),
  shortcode: z.string(),
  url: z.string().nullish(),
  application_url: z.string().nullish(),
  published_on: z.string().nullish(),
  created_at: z.string().nullish(),
  telecommuting: z.boolean().nullish(),
  country: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  locations: z.array(locationSchema).nullish(),
  description: z.string().nullish(),
});
const bodySchema = z.object({
  name: z.string().nullish(),
  jobs: z
    .array(z.unknown())
    .nullish()
    .transform((items) =>
      (items ?? []).flatMap((item) => {
        const parsed = jobSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});

const place = (parts: Array<string | null | undefined>) => parts.map((part) => part?.trim()).filter(Boolean).join(", ");

/** The account in a Workable address (apply.workable.com/zifo/j/6A9E…, zifo.workable.com), or null. */
export function workableSlugOf(url: URL) {
  const host = url.hostname.toLowerCase();
  const sub = host.match(/^([a-z0-9-]+)\.workable\.com$/)?.[1];
  if (sub && !/^(apply|jobs|www|help|resources|careers-page|api)$/.test(sub)) return sub;
  if (host !== "apply.workable.com") return null;
  const first = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(first) || /^(j|api|careers|static|assets)$/.test(first)) return null;
  return first;
}

async function account(slug: string) {
  const response = await fetch(`${API}/${encodeURIComponent(slug)}?details=true`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`workable ${slug} ${response.status}`);
  return bodySchema.parse(await response.json());
}

/** Every open job on the account, each with where it can be done (`offices`) for the India rule. */
export async function fetchWorkable(slug: string): Promise<FetchedJob[]> {
  const body = await account(slug);
  const jobs: FetchedJob[] = [];
  for (const job of body.jobs) {
    const postedAt = asDate(job.published_on ?? job.created_at);
    if (!postedAt) continue;
    const places = (job.locations ?? []).filter((item) => !item.hidden).map((item) => place([item.city, item.region, item.country]));
    const location = places[0] || place([job.city, job.state, job.country]);
    jobs.push({
      externalId: job.shortcode,
      title: job.title.trim(),
      location,
      description: plainText(job.description ?? ""),
      // The application form itself (apply.workable.com/j/<shortcode>/apply).
      applyUrl: job.application_url || `https://apply.workable.com/j/${job.shortcode}/apply`,
      postedAt,
      isRemote: job.telecommuting === true,
      offices: places.length > 1 ? places : undefined,
      raw: { shortcode: job.shortcode, location, places, published_on: job.published_on ?? null, telecommuting: job.telecommuting ?? null, url: job.url ?? null },
    });
  }
  return jobs;
}

/** The account's own name ("Zifo"), or null when the account does not exist. */
export async function workableName(slug: string) {
  const body = await account(slug).catch(() => null);
  return body?.name?.trim() || null;
}
