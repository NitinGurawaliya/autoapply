// The level of reCAPTCHA protection a company set in Ashby, sent with every posting as "recaptchaAction"
// (job_apply_none, _low, _medium, _high; seen 27 Oct). Read from Ashby's public, no-login posting query, the same the form
// page makes itself. No browser here: the web app reads it to pick an application's queue (lib/queue.ts), the worker
// before a headless click (modules/apply/adapters/ashby.ts).
export const UNPROTECTED = "job_apply_none";
const POSTING_QUERY = "query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) { jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) { id recaptchaAction } }";

/** The company and posting of an Ashby application address, or null. */
export function postingOf(url: string) {
  const match = url.match(/^https:\/\/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})(?:[/?#]|$)/i);
  return match ? { organization: decodeURIComponent(match[1]), posting: match[2] } : null;
}

/** The posting's protection level, or null when it cannot be read (callers then treat it as protected). */
export async function protectionLevel(url: string, timeoutMs = 8000): Promise<string | null> {
  const posting = postingOf(url);
  if (!posting) return null;
  try {
    const response = await fetch("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationName: "ApiJobPosting", variables: { organizationHostedJobsPageName: posting.organization, jobPostingId: posting.posting }, query: POSTING_QUERY }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const level = ((await response.json()) as { data?: { jobPosting?: { recaptchaAction?: unknown } } }).data?.jobPosting?.recaptchaAction;
    // Any text is a level: one not seen before ("job_apply_very_high") counts as protected, never as "none".
    return typeof level === "string" && level.trim() ? level.trim().slice(0, 60) : null;
  } catch {
    return null;
  }
}
