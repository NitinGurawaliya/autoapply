import { z } from "zod";
import { asDate, plainText, type FetchedJob } from "../normalize";

const jobSchema = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string().optional(),
  applyUrl: z.string().optional(),
  createdAt: z.number(),
  descriptionPlain: z.string().optional(),
  description: z.string().optional(),
  categories: z
    .object({
      location: z.string().optional(),
      commitment: z.string().optional(),
    })
    .optional(),
  workplaceType: z.string().optional(),
});

export async function fetchLever(slug: string): Promise<FetchedJob[]> {
  const response = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`lever ${slug} ${response.status}`);
  const body = (await response.json()) as unknown[];
  const jobs: FetchedJob[] = [];
  for (const item of body) {
    const parsed = jobSchema.safeParse(item);
    if (!parsed.success) continue;
    const postedAt = asDate(parsed.data.createdAt);
    const applyUrl = parsed.data.applyUrl || parsed.data.hostedUrl;
    if (!postedAt || !applyUrl) continue;
    const location = parsed.data.categories?.location ?? "";
    jobs.push({
      externalId: parsed.data.id,
      title: parsed.data.text,
      location,
      description: plainText(parsed.data.descriptionPlain ?? parsed.data.description ?? ""),
      applyUrl,
      postedAt,
      isRemote: /remote/i.test(parsed.data.workplaceType ?? "") || /remote/i.test(location),
      raw: {
        id: parsed.data.id,
        text: parsed.data.text,
        location,
        hostedUrl: parsed.data.hostedUrl ?? null,
        createdAt: parsed.data.createdAt,
      },
    });
  }
  return jobs;
}
