export type ListingState = "listed" | "gone" | "unknown";

async function exists(url: string): Promise<ListingState> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (response.ok) return "listed";
    return response.status === 404 ? "gone" : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Whether the company's own public board still lists a job. This is the authority on "closed": a page that failed to
 * load or showed odd text says nothing, so the runner asks here before it tells anyone a job is closed.
 */
export async function listingState(source: string, companySlug: string, externalId: string): Promise<ListingState> {
  const slug = encodeURIComponent(companySlug);
  const id = encodeURIComponent(externalId);
  if (source === "greenhouse") return exists(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}`);
  if (source === "lever") return exists(`https://api.lever.co/v0/postings/${slug}/${id}`);
  if (source === "ashby") {
    try {
      const response = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) return response.status === 404 ? "gone" : "unknown";
      const body = (await response.json()) as { jobs?: Array<{ id?: string }> };
      if (!Array.isArray(body.jobs) || body.jobs.length === 0) return "unknown";
      return body.jobs.some((job) => job.id === externalId) ? "listed" : "gone";
    } catch {
      return "unknown";
    }
  }
  return "unknown";
}
