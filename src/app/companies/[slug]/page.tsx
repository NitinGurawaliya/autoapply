import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Screen } from "@/components/patterns/layout";
import { applyFromShare } from "@/app/j/[slug]/actions";
import { ShareNotice, ShareTopBar } from "@/app/j/[slug]/share-sections";
import { CompanyMark } from "@/components/ui/marks";
import { boardLabel } from "@/lib/board-label";
import { departmentLabel, isDepartment } from "@/lib/department";
import { daysSince, postedLabel } from "@/lib/job-facts";
import { absoluteUrl, jobPath } from "@/lib/job-slug";
import { shareLinksEnabled } from "@/lib/share-gate";
import { employerPage, parseEmployerFilters, type EmployerJobRow } from "@/modules/jobs/employer-pages";
import { companyHref, CountHeading, Crumbs, Filters, JsonLd, Pager } from "../parts";
import { JobCard, JobCards } from "../job-cards";

type Query = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Query> };

const pageOf = (query: Query) => Number(Array.isArray(query.page) ? query.page[0] : query.page) || 1;
// One read for the metadata and the page (the arguments are plain values so the two calls share it).
const load = cache((slug: string, page: number, q: string, f: string) => employerPage(slug, page, { q, department: isDepartment(f) ? f : null }));
const filtersOf = (query: Query) => parseEmployerFilters({ q: query.q, f: query.f });

/** "Greenhouse", "Greenhouse and Workday", "Greenhouse, Workday and Keka". */
function listed(items: string[]) {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const filters = filtersOf(query);
  const found = await load(slug, pageOf(query), filters.q, filters.department ?? "");
  if (!found || found.kind !== "page") return { title: "SwipeApply", robots: { index: false, follow: false } };
  const { employer } = found;
  const count = employer.openJobs;
  const title = `${employer.name} jobs: ${count.toLocaleString("en-IN")} open ${count === 1 ? "job" : "jobs"} | SwipeApply`;
  const description = `${count.toLocaleString("en-IN")} open ${count === 1 ? "job" : "jobs"} at ${employer.name}. Upload your resume once and your agent applies for you.`;
  const url = absoluteUrl(`/companies/${employer.slug}`);
  // A search or a department is a view of the same page, not another page to index.
  const filtered = Boolean(filters.q || filters.department);
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: filtered ? { index: false, follow: true } : { index: true, follow: true },
    openGraph: { type: "website", siteName: "SwipeApply", title, description, url },
    twitter: { card: "summary", title, description },
  };
}

/** The facts on a card: place, experience, how long ago, pay: whichever the posting gives. */
function factsOf(job: EmployerJobRow): string[] {
  const place = job.location || "Location not listed";
  const where = job.remoteType === "remote" && !/remote/i.test(place) ? `${place}, remote` : place;
  return [where, job.experience, postedLabel(daysSince(job.postedAt)), job.salary].filter((fact): fact is string => Boolean(fact));
}

/** /companies/<slug> (design/companies.html 3 to 5): one employer, its open jobs from every board, India first. */
export default async function CompanyPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const filters = filtersOf(query);
  const found = await load(slug, pageOf(query), filters.q, filters.department ?? "");
  if (!found) notFound();
  if (found.kind === "redirect") permanentRedirect(`/companies/${found.slug}`);
  const { employer, india, abroad, page, pages, total, indiaTotal, all, departments } = found;
  const linked = shareLinksEnabled();
  const boards = listed(employer.boards.map((source) => boardLabel(source) ?? source));
  const url = absoluteUrl(`/companies/${employer.slug}`);
  const filtered = Boolean(filters.q || filters.department);
  const cards = (jobs: EmployerJobRow[]) => (
    <JobCards>
      {jobs.map((job) => (
        <JobCard
          key={job.id}
          id={job.id}
          title={job.title}
          department={job.department}
          departmentLabel={departmentLabel(job.department)}
          isNew={job.isNew}
          facts={factsOf(job)}
          href={linked ? `${jobPath({ id: job.id, title: job.title, company: { name: job.companyName } })}?s=co` : null}
          apply={linked && job.applyable ? applyFromShare.bind(null, job.id) : null}
        />
      ))}
    </JobCards>
  );
  return (
    <Screen className="px-5 pb-10 lg:max-w-4xl lg:px-8">
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
      <header className="flex items-center gap-3.5 pt-2 lg:gap-5">
        <CompanyMark name={employer.name} logoUrl={employer.logoUrl} size={56} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 type-heading break-words lg:text-[32px]">{employer.name}</h1>
          {employer.domain ? (
            <a href={`https://${employer.domain}`} target="_blank" rel="noopener nofollow" className="truncate type-meta text-muted-foreground underline decoration-1 underline-offset-4">
              {employer.domain}
            </a>
          ) : null}
        </div>
      </header>
      <div className="mt-3.5 flex flex-col gap-0.5">
        <span className="type-section">
          {employer.openJobs.toLocaleString("en-IN")} open {employer.openJobs === 1 ? "job" : "jobs"}
        </span>
        {boards ? <span className="type-meta text-muted-foreground">Hires through {boards}</span> : null}
        <span className="type-meta text-muted-foreground">Upload your resume once. Your agent fills in the forms and sends them.</span>
      </div>

      <Filters slug={employer.slug} name={employer.name} departments={departments} all={all} filters={filters} />

      {total === 0 ? (
        <ShareNotice title="No jobs match">
          {filters.q ? `Nothing here matches “${filters.q}”` : "Nothing here"}
          {filters.department ? ` in ${departmentLabel(filters.department)}` : ""}.{" "}
          <Link href={companyHref(employer.slug, { q: "", department: null })} className="underline decoration-1 underline-offset-4">
            Show all {employer.openJobs.toLocaleString("en-IN")} jobs
          </Link>
        </ShareNotice>
      ) : (
        <>
          {filtered ? (
            <p className="m-0 mt-4 type-meta text-muted-foreground">
              {total.toLocaleString("en-IN")} {total === 1 ? "job" : "jobs"}
              {filters.department ? ` in ${departmentLabel(filters.department)}` : ""}
              {filters.q ? ` matching “${filters.q}”` : ""}
            </p>
          ) : null}
          {!filtered && employer.openIndia === 0 ? <ShareNotice title="None in India right now">Its open jobs are in other countries.</ShareNotice> : null}
          {india.length > 0 ? (
            <section className="mt-6">
              <CountHeading count={indiaTotal}>In India</CountHeading>
              {cards(india)}
            </section>
          ) : null}
          {abroad.length > 0 ? (
            <section className="mt-6">
              <CountHeading count={total - indiaTotal}>Outside India</CountHeading>
              {cards(abroad)}
            </section>
          ) : null}
          <Pager href={(n) => companyHref(employer.slug, filters, n)} page={page} pages={pages} />
        </>
      )}
    </Screen>
  );
}
