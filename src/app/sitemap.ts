import type { MetadataRoute } from "next";
import { companyPagesEnabled } from "@/lib/company-pages-gate";
import { absoluteUrl, jobPath } from "@/lib/job-slug";
import { shareLinksEnabled } from "@/lib/share-gate";
import { indexableJobCount, LETTERS, SITEMAP_JOBS_PER_FILE, sitemapEmployers, sitemapJobs } from "@/modules/jobs/employer-pages";

// Phase W7 (docs/employers/TDD.md 4.2). Sitemap 0: /companies, the letters and every listed employer. Sitemaps 1 to n:
// the open jobs whose pages carry JobPosting data, 45,000 to a file (Google's limit is 50,000). They are served at
// /sitemap/<id>.xml and named in robots.txt. Nothing while the company pages are switched off.
export const dynamic = "force-dynamic";

export async function generateSitemaps() {
  const jobs = companyPagesEnabled() && shareLinksEnabled() ? await indexableJobCount() : 0;
  return Array.from({ length: 1 + Math.ceil(jobs / SITEMAP_JOBS_PER_FILE) }, (_, id) => ({ id }));
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  if (!companyPagesEnabled()) return [];
  const id = Number(await props.id);
  if (id === 0) {
    const employers = await sitemapEmployers();
    return [
      { url: absoluteUrl("/companies") },
      ...[...LETTERS, "0"].map((letter) => ({ url: absoluteUrl(`/companies/browse/${letter}`) })),
      ...employers.map((employer) => ({ url: absoluteUrl(`/companies/${employer.slug}`), lastModified: employer.updatedAt })),
    ];
  }
  if (!shareLinksEnabled() || !Number.isInteger(id) || id < 1) return [];
  const jobs = await sitemapJobs(id - 1);
  return jobs.map((job) => ({ url: absoluteUrl(jobPath({ id: job.id, title: job.title, company: { name: job.companyName } })), lastModified: job.fetchedAt }));
}
