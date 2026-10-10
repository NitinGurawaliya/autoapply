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

export async function fetchGreenhouse(slug: string): Promise<FetchedJob[]> {
  const response = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
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
