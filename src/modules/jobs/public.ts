import { z } from "zod";
import { db } from "@/lib/db";
import { SITES } from "@/modules/sources/sites";
import { APPLY_BOARDS } from "./pool";

/**
 * One job as a stranger may see it (share links, Phase U, docs/share/TDD.md §4.1 item 2): named public columns only,
 * never `raw`, `questions`, `embedding` or anything about a user. The reading's summary and requirement lines are
 * parsed here so the page never touches the Json column.
 */

const readingSchema = z.object({
  summary: z.string().catch(""),
  requirements: z.array(z.string()).catch([]),
});

export type PublicJob = {
  id: string;
  title: string;
  location: string;
  remoteType: string;
  experienceMin: number | null;
  seniority: string | null;
  description: string;
  source: string;
  country: string;
  eligibility: string;
  kind: string | null;
  postedAt: Date;
  closedAt: Date | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  company: { name: string; logoUrl: string | null };
  /** The real employer of the company (Phase W), for its page and the JobPosting data; null until linked. */
  /** When the board account was last read (the job is only as fresh as that: JobPosting data needs it within 3 days). */
  companyLastFetchedAt: Date | null;
  employer: { slug: string; name: string; domain: string | null; logoUrl: string | null; openJobs: number } | null;
  summary: string | null;
  requirements: string[];
  /** The agent applies on this job's board. */
  applyable: boolean;
  /** The company's own posting (its board's public page), for "View the original posting"; null unless https. */
  postingUrl: string | null;
};

export async function publicJob(id: string): Promise<PublicJob | null> {
  const job = await db.job.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      location: true,
      remoteType: true,
      experienceMin: true,
      seniority: true,
      description: true,
      source: true,
      country: true,
      eligibility: true,
      kind: true,
      postedAt: true,
      closedAt: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryPeriod: true,
      applyUrl: true,
      reading: true,
      readingCurrent: true,
      company: { select: { name: true, logoUrl: true, lastFetchedAt: true, employer: { select: { slug: true, name: true, domain: true, logoUrl: true, openJobs: true } } } },
    },
  });
  if (!job) return null;
  // Signed-in sources (Naukri) are read through a user's own account and never republished (docs/employers/TDD.md 4.7).
  if ((SITES as readonly string[]).includes(job.source)) return null;
  const { reading, readingCurrent, applyUrl, company, ...rest } = job;
  const parsed = readingCurrent && reading != null ? readingSchema.safeParse(reading) : null;
  const read = parsed?.success ? parsed.data : null;
  return {
    ...rest,
    company: { name: company.name, logoUrl: company.logoUrl },
    employer: company.employer,
    companyLastFetchedAt: company.lastFetchedAt,
    summary: read?.summary.trim() || null,
    requirements: (read?.requirements ?? []).map((line) => line.trim()).filter(Boolean).slice(0, 6),
    applyable: APPLY_BOARDS.includes(job.source),
    postingUrl: /^https:\/\//i.test(applyUrl) ? applyUrl : null,
  };
}
