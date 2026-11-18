import type { FeedJob } from "@/modules/jobs";

// The facts a job card and the job page show the same way (Phase M6, M7: design/job-card.html, design/job.html).

export const REMOTE_LABEL: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
export const STAGE_LABEL: Record<string, string> = { startup: "Startup", midsize: "Mid-size", mnc: "MNC" };

/** "Bengaluru · On-site". */
export function whereLabel(job: Pick<FeedJob, "location" | "remoteType">) {
  return [job.location, REMOTE_LABEL[job.remoteType]].filter(Boolean).join(" · ") || "Location not listed";
}

/** "Fresher", "2+ yrs", "2+ yrs · you have 1" when it asks more than the candidate has, "Years not stated". */
export function experienceChip(job: Pick<FeedJob, "requiredYears" | "seniority" | "yourYears">): { label: string; over: boolean } {
  const asks = job.requiredYears;
  if (asks == null) return { label: job.seniority === "intern" || job.seniority === "entry" ? "Fresher" : "Years not stated", over: false };
  if (asks <= 0) return { label: "Fresher", over: false };
  // Unknown years are not zero: without them the chip states what the job asks and compares nothing.
  if (job.yourYears == null) return { label: `${asks}+ yrs`, over: false };
  const have = Math.floor(job.yourYears);
  return asks > have ? { label: `${asks}+ yrs · you have ${have}`, over: true } : { label: `${asks}+ yrs`, over: false };
}

/** Whole days since a date (0 = today). */
export function daysSince(date: Date) {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

/** "Posted today", "Posted 1 day ago", "Posted 11 days ago". */
export function postedLabel(daysAgo: number) {
  return daysAgo <= 0 ? "Posted today" : `Posted ${daysAgo === 1 ? "1 day" : `${daysAgo} days`} ago`;
}
