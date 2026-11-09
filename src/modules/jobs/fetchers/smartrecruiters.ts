import { z } from "zod";
import { asDate, plainText, type FetchedJob } from "../normalize";

/**
 * SmartRecruiters (Phase M, M7; T95): the public Posting API, no sign-in. The list asks for India only (`country=in`),
 * 100 a page; each posting's description is a second call, made only for postings ingest does not hold yet (`known`,
 * as Workday). `Company.slug` is the company identifier in its job addresses ("Freshworks" in
 * jobs.smartrecruiters.com/Freshworks/…); the API takes it in any case ("SWIGGY" and "Swiggy" both answer).
 */

const API = "https://api.smartrecruiters.com/v1/companies";
const PAGE = 100;
const MAX_JOBS = 2000;
const DETAIL_CONCURRENCY = 4;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const postingSchema = z.object({
  id: z.string(),
  name: z.string(),
  releasedDate: z.string().optional(),
  company: z.object({ identifier: z.string().optional(), name: z.string().optional() }).optional(),
  location: z
    .object({ city: z.string().optional(), country: z.string().optional(), remote: z.boolean().optional(), fullLocation: z.string().optional() })
    .optional(),
});
const listSchema = z.object({
  totalFound: z.number().optional(),
  content: z
    .array(z.unknown())
    .optional()
    .transform((items) => items?.flatMap((item) => {
      const parsed = postingSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })),
});
const section = z.object({ title: z.string().optional(), text: z.string().optional() }).optional();
const detailSchema = postingSchema.extend({
  applyUrl: z.string().optional(),
  postingUrl: z.string().optional(),
  jobAd: z.object({ sections: z.object({ companyDescription: section, jobDescription: section, qualifications: section, additionalInformation: section }).partial().optional() }).optional(),
});

type Posting = z.infer<typeof postingSchema>;

/** The identifier in a SmartRecruiters address (jobs.smartrecruiters.com/Freshworks/…, careers.smartrecruiters.com/Swiggy). */
export function smartRecruitersSlugOf(url: URL) {
  if (!/^(jobs|careers)\.smartrecruiters\.com$/i.test(url.hostname)) return null;
  const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,80}$/.test(first) || /^(oneclick-ui|api|static|sr-jobs|en|app)$/i.test(first)) return null;
  return first;
}

async function page(slug: string, offset: number) {
  const response = await fetch(`${API}/${encodeURIComponent(slug)}/postings?limit=${PAGE}&offset=${offset}&country=in`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`smartrecruiters ${slug} ${response.status}`);
  return listSchema.parse(await response.json());
}

function listed(slug: string, posting: Posting): FetchedJob | null {
  const postedAt = asDate(posting.releasedDate);
  if (!postedAt) return null;
  const location = posting.location?.fullLocation?.replace(/,\s*,/g, ",") ?? posting.location?.city ?? "";
  return {
    externalId: posting.id,
    title: posting.name.trim(),
    location,
    description: "",
    applyUrl: `https://jobs.smartrecruiters.com/${encodeURIComponent(posting.company?.identifier ?? slug)}/${posting.id}`,
    postedAt,
    isRemote: posting.location?.remote === true,
    // The list was asked for India only.
    offices: posting.location?.country?.toLowerCase() === "in" ? ["India"] : undefined,
    raw: { id: posting.id, location, releasedDate: posting.releasedDate ?? null, remote: posting.location?.remote ?? null },
  };
}

/** The company's India postings. A slug that is not a company answers with an empty list (the API's own answer). */
export async function fetchSmartRecruiters(slug: string, options: { details?: boolean; known?: ReadonlySet<string> } = {}): Promise<FetchedJob[]> {
  const postings: Posting[] = [];
  for (let offset = 0; offset < MAX_JOBS; offset += PAGE) {
    const body = await page(slug, offset);
    const items = body.content ?? [];
    postings.push(...items);
    if (items.length < PAGE || postings.length >= (body.totalFound ?? 0)) break;
    await pause(200);
  }
  if (options.details === false) return postings.map((posting) => listed(slug, posting)).filter((job): job is FetchedJob => !!job);

  const jobs: FetchedJob[] = [];
  const known = options.known;
  for (const posting of postings) {
    if (!known?.has(posting.id)) continue;
    const job = listed(slug, posting);
    if (job) jobs.push({ ...job, listOnly: true });
  }
  const toRead = known ? postings.filter((posting) => !known.has(posting.id)) : postings;
  let next = 0;
  const worker = async () => {
    while (next < toRead.length) {
      const posting = toRead[next++];
      const response = await fetch(`${API}/${encodeURIComponent(slug)}/postings/${posting.id}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) }).catch(() => null);
      const parsed = response?.ok ? detailSchema.safeParse(await response.json().catch(() => null)) : null;
      await pause(150);
      const base = listed(slug, posting);
      if (!base) continue;
      if (!parsed?.success) {
        // A posting whose detail fails is kept from the list alone rather than closed.
        jobs.push(base);
        continue;
      }
      const sections = parsed.data.jobAd?.sections ?? {};
      const text = [sections.jobDescription, sections.qualifications, sections.additionalInformation, sections.companyDescription]
        .filter((part) => part?.text)
        .map((part) => `${part?.title ?? ""}\n${part?.text ?? ""}`)
        .join("\n\n");
      jobs.push({ ...base, description: plainText(text), applyUrl: parsed.data.postingUrl ?? base.applyUrl });
    }
  };
  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));
  return jobs;
}

/** The company's own name, from its first posting (any country), or null when the identifier lists nothing. */
export async function smartRecruitersName(slug: string) {
  const response = await fetch(`${API}/${encodeURIComponent(slug)}/postings?limit=1`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!response?.ok) return null;
  const body = listSchema.safeParse(await response.json().catch(() => null));
  const name = body.success ? body.data.content?.[0]?.company?.name?.trim() : undefined;
  if (!name) return null;
  // "SWIGGY" reads better as "Swiggy".
  return name === name.toUpperCase() && name.length > 3 ? name[0] + name.slice(1).toLowerCase() : name;
}
