import type { PublicJob } from "@/modules/jobs/public";
import { PRIVATE_SOURCES } from "@/modules/jobs/private-sources";

// schema.org JobPosting data for a job's public page (Phase W7, docs/employers/TDD.md 4.2), the form Google reads for
// its job results. Pure. Nothing is inferred to fill a field: what the board did not give is left out, and a job we
// cannot describe completely gets no markup at all (and the page says noindex).

const FRESH_MS = 3 * 24 * 60 * 60 * 1000;
const EMPLOYMENT: Record<string, string> = { full_time: "FULL_TIME", part_time: "PART_TIME", contract: "CONTRACTOR", internship: "INTERN", temporary: "TEMPORARY" };
const UNIT: Record<string, string> = { year: "YEAR", month: "MONTH", hour: "HOUR" };

/**
 * Whether a job's page carries JobPosting data and is indexable: open, from a public source, one the page can describe
 * in full (the agent applies on its board: the page then shows the whole description), and its company read in the
 * last 3 days, so a job gone from the board does not stay in search results.
 */
export function postingIndexable(job: Pick<PublicJob, "closedAt" | "source" | "applyable" | "companyLastFetchedAt">, now = Date.now()): boolean {
  if (job.closedAt || !job.applyable || PRIVATE_SOURCES.includes(job.source)) return false;
  return job.companyLastFetchedAt != null && now - job.companyLastFetchedAt.getTime() <= FRESH_MS;
}

export type PostingInput = Pick<
  PublicJob,
  "title" | "description" | "location" | "remoteType" | "country" | "eligibility" | "kind" | "postedAt" | "closedAt" | "source" | "applyable" | "companyLastFetchedAt" | "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod"
> & { company: { name: string; logoUrl: string | null }; employer: { name: string; domain: string | null; logoUrl: string | null } | null };

/** The JobPosting object for a job's page, or null when the job gets none. `url` is the page's canonical address. */
export function jobPostingJsonLd(job: PostingInput, url: string, now = Date.now()): Record<string, unknown> | null {
  if (!postingIndexable(job, now)) return null;
  const description = job.description.trim();
  if (!job.title.trim() || !description) return null;
  const remote = job.eligibility === "remote_india" && job.remoteType === "remote";
  const country = /^[A-Z]{2}$/.test(job.country) ? job.country : job.eligibility === "india" || job.eligibility === "remote_india" ? "IN" : null;
  const locality = job.location.split(/[,;|]/)[0]?.trim();
  // A place we cannot name is a posting we cannot describe: Google requires one (or remote with the countries).
  if (!remote && (!country || !locality)) return null;
  const name = job.employer?.name ?? job.company.name;
  const logo = job.employer?.logoUrl ?? job.company.logoUrl;
  const organization: Record<string, unknown> = { "@type": "Organization", name };
  if (job.employer?.domain) organization.sameAs = `https://${job.employer.domain}`;
  if (logo && /^https:\/\//.test(logo)) organization.logo = logo;
  const unit = job.salaryPeriod ? UNIT[job.salaryPeriod] : undefined;
  const employmentType = job.kind ? EMPLOYMENT[job.kind] : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title.trim(),
    description,
    datePosted: job.postedAt.toISOString(),
    hiringOrganization: organization,
    directApply: false,
    url,
    ...(remote
      ? { jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "India" } }
      : { jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: locality, addressCountry: country } } }),
    ...(employmentType ? { employmentType } : {}),
    ...(job.salaryMin != null && job.salaryCurrency && unit
      ? {
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: job.salaryCurrency,
            value: { "@type": "QuantitativeValue", minValue: job.salaryMin, ...(job.salaryMax != null ? { maxValue: job.salaryMax } : {}), unitText: unit },
          },
        }
      : {}),
  };
}
