import { z } from "zod";
import { asDate, plainText, type FetchedJob } from "../normalize";

const jobSchema = z.object({
  id: z.string(),
  title: z.string(),
  location: z.string().optional(),
  isRemote: z.boolean().optional(),
  publishedAt: z.string().optional(),
  jobUrl: z.string().optional(),
  applyUrl: z.string().optional(),
  descriptionPlain: z.string().optional(),
  descriptionHtml: z.string().optional(),
});

export async function fetchAshby(slug: string): Promise<FetchedJob[]> {
  const response = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`ashby ${slug} ${response.status}`);
  const body = (await response.json()) as { jobs?: unknown[] };
  const jobs: FetchedJob[] = [];
  for (const item of body.jobs ?? []) {
    const parsed = jobSchema.safeParse(item);
    if (!parsed.success) continue;
    const postedAt = asDate(parsed.data.publishedAt);
    const applyUrl = parsed.data.applyUrl || parsed.data.jobUrl;
    if (!postedAt || !applyUrl) continue;
    jobs.push({
      externalId: parsed.data.id,
      title: parsed.data.title,
      location: parsed.data.location ?? "",
      description: plainText(parsed.data.descriptionPlain ?? parsed.data.descriptionHtml ?? ""),
      applyUrl,
      postedAt,
      isRemote: parsed.data.isRemote,
      raw: {
        id: parsed.data.id,
        title: parsed.data.title,
        location: parsed.data.location ?? "",
        isRemote: parsed.data.isRemote ?? false,
        publishedAt: parsed.data.publishedAt ?? null,
        jobUrl: parsed.data.jobUrl ?? null,
      },
    });
  }
  return jobs;
}
