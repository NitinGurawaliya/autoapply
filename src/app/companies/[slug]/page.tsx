import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Screen } from "@/components/patterns/layout";
import { applyFromShare } from "@/app/j/[slug]/actions";
import { ShareNotice, ShareTopBar } from "@/app/j/[slug]/share-sections";
import { CompanyMark } from "@/components/ui/marks";
import { getCurrentUser } from "@/lib/auth";
import { cachedFeedScore } from "@/lib/feed-cache";
import { statusMeta } from "@/lib/status-meta";
import { boardLabel } from "@/lib/board-label";
import { departmentLabel, isDepartment } from "@/lib/department";
import { daysSince, postedLabel } from "@/lib/job-facts";
import { absoluteUrl, jobPath } from "@/lib/job-slug";
import { shareLinksEnabled } from "@/lib/share-gate";
import { employerPage, myApplicationsAt, parseEmployerFilters, type EmployerJobRow, type MyApplication } from "@/modules/jobs/employer-pages";
import { employerFits } from "@/modules/jobs/browse";
import { loadRules } from "@/modules/governance";
import { applyToMatching } from "../actions";
import { ApplyAll } from "../apply-all";
import { companyHref, CountHeading, Crumbs, Filters, JsonLd, Pager } from "../parts";
import { JobCard, JobCards, type JobStatus } from "../job-cards";

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
  return [where, job.experience, postedLabel(daysSince(job.postedAt))].filter((fact): fact is string => Boolean(fact));
}

/** /companies/<slug> (design/companies.html 3 to 5): one employer, its open jobs from every board, India first. */
export default async function CompanyPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const filters = filtersOf(query);
  const [first, user] = await Promise.all([load(slug, pageOf(query), filters.q, filters.department ?? ""), getCurrentUser()]);
  if (!first) notFound();
  if (first.kind === "redirect") permanentRedirect(`/companies/${first.slug}`);
  // Signed in with a profile (Phase X, X4): each job judged against it; the matching ones come first, the rest say why.
  const fits = user?.hasProfile ? await employerFits(user.id, first.employer.id) : null;
  const found = fits ? ((await employerPage(slug, pageOf(query), filters, fits)) ?? first) : first;
  if (found.kind !== "page") notFound();
  const { employer, matched, india, abroad, page, pages, total, indiaTotal, all, newThisWeek, departments } = found;
  // Signed in: what they have already done at this employer.
  const mine = user ? await myApplicationsAt(user.id, employer.id, [...matched, ...india, ...abroad].map((job) => job.id)) : null;
  // The matching jobs they haven't applied to: what "Apply to all that fit" sends (X5).
  const open = matched.filter((job) => !mine?.byJob.has(job.id));
  const statusOf = (application: MyApplication | undefined): JobStatus | null => {
    if (!application) return null;
    const meta = statusMeta(application.status);
    return { label: meta.label, group: meta.group, href: `/applications/${application.applicationId}` };
  };
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
          salary={job.salary}
          score={job.fit ? job.fit.score : user?.hasProfile ? cachedFeedScore(user.id, job.id) : null}
          status={statusOf(mine?.byJob.get(job.id))}
          href={linked ? `${jobPath({ id: job.id, title: job.title, company: { name: job.companyName } })}?s=co` : null}
          // A job that doesn't match the profile has no Apply (owner, 27 Nov): its reason shows instead.
          apply={linked && job.applyable && (!job.fit || job.fit.matches) ? applyFromShare.bind(null, job.id) : null}
          notMatching={job.fit && !job.fit.matches ? job.fit.reasons : null}
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
      <ShareTopBar right={user ? "feed" : "sign-in"} />
      <Crumbs />
      <header className="flex items-center gap-4 pt-2 lg:gap-6">
        <CompanyMark name={employer.name} logoUrl={employer.logoUrl} size={56} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 type-heading break-words lg:type-hero">{employer.name}</h1>
          {employer.domain ? (
            <a href={`https://${employer.domain}`} target="_blank" rel="noopener nofollow" className="truncate type-meta text-muted-foreground underline decoration-1 underline-offset-4">
              {employer.domain}
            </a>
          ) : null}
        </div>
      </header>
      <dl className="m-0 mt-6 flex gap-8 border-y border-line py-4 lg:gap-12">
        {[
          { n: employer.openJobs, label: employer.openJobs === 1 ? "Open role" : "Open roles" },
          { n: departments.length, label: departments.length === 1 ? "Department" : "Departments" },
          ...(newThisWeek > 0 ? [{ n: newThisWeek, label: "New this week" }] : []),
        ].map((stat) => (
          <div key={stat.label} className="flex flex-col gap-1">
            <dt className="order-2 type-label text-muted-foreground">{stat.label}</dt>
            <dd className="m-0 type-heading tabular-nums">{stat.n.toLocaleString("en-IN")}</dd>
          </div>
        ))}
      </dl>
      {boards ? <p className="m-0 mt-3 type-meta text-muted-foreground">Hires through {boards}</p> : null}
      {user ? (
        <div className="mt-4 rounded-card bg-surface p-4 ring-1 ring-line">
          {mine && mine.applied > 0 ? (
            <p className="m-0 type-body">
              <span className="font-semibold">
                You have applied to {mine.applied} {mine.applied === 1 ? "job" : "jobs"} here
              </span>
              {mine.sent > 0 ? `, ${mine.sent} sent` : ""}.{" "}
              <Link href="/applications" className="underline decoration-1 underline-offset-4">
                See your applications
              </Link>
            </p>
          ) : user.hasProfile ? (
            <p className="m-0 type-body">Your agent fills in the form and sends it. Tap Apply on any role.</p>
          ) : (
            <p className="m-0 type-body">Upload your resume once and your agent can apply to any of these. Tap Apply to start.</p>
          )}
        </div>
      ) : (
        <p className="m-0 mt-3 type-meta text-muted-foreground">Upload your resume once. Your agent fills in the forms and sends them.</p>
      )}

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
          {fits ? (
            <section className="mt-6">
              <CountHeading count={matched.length}>Matches your profile</CountHeading>
              {open.length >= 2 ? (
                <ApplyAll
                  company={employer.name}
                  jobs={open.map((job) => ({ id: job.id, title: job.title, score: job.fit?.score ?? null }))}
                  perWeek={loadRules().max_per_company_per_week}
                  action={applyToMatching.bind(null, employer.slug)}
                />
              ) : null}
              {matched.length > 0 ? (
                cards(matched)
              ) : (
                <p className="m-0 mt-2 type-meta text-muted-foreground">
                  None of {employer.name}&apos;s open roles{filtered ? " here" : ""} match your profile right now. Each role below says why.
                </p>
              )}
            </section>
          ) : null}
          {fits && india.length + abroad.length > 0 ? <h2 className="m-0 mt-8 type-section">Other roles here</h2> : null}
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
