import { createHash } from "node:crypto";
import { z } from "zod";
import { asDate, plainText, type FetchedJob } from "../normalize";

const jobSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  absolute_url: z.string().optional(),
  location: z.object({ name: z.string().optional() }).optional(),
  offices: z.array(z.object({ name: z.string().nullish(), location: z.string().nullish() })).optional(),
  content: z.string().optional(),
  first_published: z.string().optional(),
  updated_at: z.string().optional(),
});

/**
 * The board's list without descriptions (a few KB instead of ~6 KB a job), hashed over ids and update times (M2): when
 * it is unchanged since the last read, so is everything ingest stores from it.
 */
export async function greenhouseListHash(slug: string): Promise<string> {
  const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`greenhouse ${slug} ${response.status}`);
  const body = (await response.json()) as { jobs?: Array<{ id?: unknown; updated_at?: unknown }> };
  const keys = (body.jobs ?? []).map((job) => `${String(job.id)}:${String(job.updated_at)}`).sort();
  return createHash("md5").update(keys.join("|")).digest("hex");
}

/**
 * The board's open jobs from its list without descriptions: title, place and dates, enough for discovery to count India
 * jobs without downloading every description (M3: thousands of boards checked once). Null when the board is not there.
 */
export async function fetchGreenhouseList(slug: string): Promise<FetchedJob[] | null> {
  const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`, { signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`greenhouse ${slug} ${response.status}`);
  const body = (await response.json()) as { jobs?: unknown[] };
  const jobs: FetchedJob[] = [];
  for (const item of body.jobs ?? []) {
    const parsed = jobSchema.safeParse(item);
    if (!parsed.success) continue;
    const postedAt = asDate(parsed.data.first_published) ?? asDate(parsed.data.updated_at);
    if (!postedAt || !parsed.data.absolute_url) continue;
    jobs.push({ externalId: String(parsed.data.id), title: parsed.data.title, location: parsed.data.location?.name ?? "", description: "", applyUrl: parsed.data.absolute_url, postedAt, raw: {} });
  }
  return jobs;
}

export async function fetchGreenhouse(slug: string): Promise<FetchedJob[]> {
  const response = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok) throw new Error(`greenhouse ${slug} ${response.status}`);
  const body = (await response.json()) as { jobs?: unknown[] };
  const jobs: FetchedJob[] = [];
  for (const item of body.jobs ?? []) {
    const parsed = jobSchema.safeParse(item);
    if (!parsed.success) continue;
    const postedAt = asDate(parsed.data.first_published) ?? asDate(parsed.data.updated_at);
    const applyUrl = parsed.data.absolute_url;
    if (!postedAt || !applyUrl) continue;
    const offices = (parsed.data.offices ?? []).map((office) => [office.name, office.location].filter(Boolean).join(" @ ")).filter(Boolean);
    jobs.push({
      externalId: String(parsed.data.id),
      title: parsed.data.title,
      location: parsed.data.location?.name ?? "",
      description: plainText(parsed.data.content ?? ""),
      applyUrl,
      postedAt,
      offices,
      raw: {
        id: parsed.data.id,
        title: parsed.data.title,
        location: parsed.data.location?.name ?? "",
        offices,
        absolute_url: applyUrl,
        first_published: parsed.data.first_published ?? null,
        updated_at: parsed.data.updated_at ?? null,
      },
    });
  }
  return jobs;
}
