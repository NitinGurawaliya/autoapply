import type { MetadataRoute } from "next";
import { companyPagesEnabled } from "@/lib/company-pages-gate";
import { absoluteUrl } from "@/lib/job-slug";
import { shareLinksEnabled } from "@/lib/share-gate";
import { indexableJobCount, SITEMAP_JOBS_PER_FILE } from "@/modules/jobs/employer-pages";

// Phase W7 (docs/employers/TDD.md 4.2): crawlers may read the company pages and the job pages; the app, the API and
// the mock forms are closed to them. While both public surfaces are switched off, nothing is open.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const companies = companyPagesEnabled();
  const jobs = shareLinksEnabled();
  if (!companies && !jobs) return { rules: { userAgent: "*", disallow: "/" } };
  const files = companies ? 1 + (jobs ? Math.ceil((await indexableJobCount()) / SITEMAP_JOBS_PER_FILE) : 0) : 0;
  return {
    rules: {
      userAgent: "*",
      allow: [...(companies ? ["/companies"] : []), ...(jobs ? ["/j/"] : [])],
      disallow: ["/api/", "/feed", "/applications", "/account", "/answers", "/gaps", "/governance", "/jobs/", "/onboarding", "/mock", "/dev", "/sign-in"],
    },
    sitemap: Array.from({ length: files }, (_, id) => absoluteUrl(`/sitemap/${id}.xml`)),
  };
}
