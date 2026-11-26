import type { Metadata } from "next";
import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { Screen } from "@/components/patterns/layout";
import { ShareNotice, ShareTopBar } from "@/app/j/[slug]/share-sections";
import { CompanyMark } from "@/components/ui/marks";
import { boardLabel } from "@/lib/board-label";
import { absoluteUrl } from "@/lib/job-slug";
import { shareLinksEnabled } from "@/lib/share-gate";
import { employerPage } from "@/modules/jobs/employer-pages";
import { ApplyBar, CountHeading, Crumbs, JobList, JsonLd, Pager } from "../parts";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const pageOf = (query: Record<string, string | string[] | undefined>) => Number(Array.isArray(query.page) ? query.page[0] : query.page) || 1;
// One read for the metadata and the page.
const load = cache(employerPage);

/** "Greenhouse", "Greenhouse and Workday", "Greenhouse, Workday and Keka". */
function listed(items: string[]) {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const found = await load(slug, pageOf(query));
  if (!found || found.kind !== "page") return { title: "SwipeApply", robots: { index: false, follow: false } };
  const { employer } = found;
  const count = employer.openJobs;
  const title = `${employer.name} jobs: ${count.toLocaleString("en-IN")} open ${count === 1 ? "job" : "jobs"} | SwipeApply`;
  const description = `${count.toLocaleString("en-IN")} open ${count === 1 ? "job" : "jobs"} at ${employer.name}. Upload your resume once and your agent applies for you.`;
  const url = absoluteUrl(`/companies/${employer.slug}`);
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { type: "website", siteName: "SwipeApply", title, description, url },
    twitter: { card: "summary", title, description },
  };
}

/** /companies/<slug> (design/companies.html 3 to 5): one employer, its open jobs from every board, India first. */
export default async function CompanyPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const found = await load(slug, pageOf(query));
  if (!found) notFound();
  if (found.kind === "redirect") permanentRedirect(`/companies/${found.slug}`);
  const { employer, india, abroad, page, pages } = found;
  const linked = shareLinksEnabled();
  const boards = listed(employer.boards.map((source) => boardLabel(source) ?? source));
  const outside = Math.max(0, employer.openJobs - employer.openIndia);
  const url = absoluteUrl(`/companies/${employer.slug}`);
  return (
    <Screen className="px-5">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: employer.name,
          url: employer.domain ? `https://${employer.domain}` : url,
          ...(employer.logoUrl && /^https:\/\//.test(employer.logoUrl) ? { logo: employer.logoUrl } : {}),
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Companies", item: absoluteUrl("/companies") },
            { "@type": "ListItem", position: 2, name: employer.name, item: url },
          ],
        }}
      />
      <ShareTopBar right="sign-in" />
      <Crumbs />
      <header className="flex items-center gap-3.5 pt-2">
        <CompanyMark name={employer.name} logoUrl={employer.logoUrl} size={56} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 type-heading break-words">{employer.name}</h1>
          {employer.domain ? (
            <a href={`https://${employer.domain}`} target="_blank" rel="noopener nofollow" className="truncate type-meta text-muted-foreground underline decoration-1 underline-offset-4">
              {employer.domain}
            </a>
          ) : null}
        </div>
      </header>
      <div className="mt-3.5 flex flex-col gap-0.5">
        <span className="type-section">
          <span className="tabular-nums">{employer.openJobs.toLocaleString("en-IN")}</span> open {employer.openJobs === 1 ? "job" : "jobs"}
        </span>
        {boards ? <span className="type-meta text-muted-foreground">Hires through {boards}</span> : null}
      </div>

      {employer.openIndia === 0 ? (
        <ShareNotice title="None in India right now">Its open jobs are in other countries.</ShareNotice>
      ) : india.length > 0 ? (
        <section className="mt-7">
          <CountHeading count={employer.openIndia}>In India</CountHeading>
          <JobList jobs={india} linked={linked} />
        </section>
      ) : null}
      {abroad.length > 0 ? (
        <section className="mt-5">
          <CountHeading count={outside}>Outside India</CountHeading>
          <JobList jobs={abroad} linked={linked} />
        </section>
      ) : null}
      <Pager base={`/companies/${employer.slug}`} page={page} pages={pages} />
      <ApplyBar />
    </Screen>
  );
}
