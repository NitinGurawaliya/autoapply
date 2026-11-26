import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { CompanyMark } from "@/components/ui/marks";
import { daysSince, postedLabel } from "@/lib/job-facts";
import { jobPath } from "@/lib/job-slug";
export { JsonLd } from "@/components/patterns/json-ld";
import { LETTERS, type EmployerJobRow, type EmployerRow } from "@/modules/jobs/employer-pages";

// The company pages' parts (design/companies.html, Phase W5): public, outside the signed-in shell.

/** The letter a name key starts with, as shown: "a" → "A", "0" → "#". */
export const letterLabel = (letter: string) => (letter === "0" ? "#" : letter.toUpperCase());

/** "Companies >" above a title, one tap back up. */
export function Crumbs() {
  return (
    <nav aria-label="Breadcrumb" className="mt-1 flex min-h-11 items-center gap-1">
      <Link href="/companies" className="type-meta text-muted-foreground underline decoration-1 underline-offset-4">
        Companies
      </Link>
      <Icon name="chevronRight" size={14} className="text-faint" />
    </nav>
  );
}

/** A to Z and #: a letter with a company is a tag; one with none is plain grey text, not a dead button. */
export function LetterStrip({ counts }: { counts: Array<{ letter: string; count: number }> }) {
  const has = new Set(counts.filter((row) => row.count > 0).map((row) => row.letter));
  return (
    <nav aria-label="Companies by letter" className="mt-4 grid grid-cols-7 gap-1.5">
      {[...LETTERS, "0"].map((letter) =>
        has.has(letter) ? (
          <Link key={letter} href={`/companies/browse/${letter}`} className="flex h-11 items-center justify-center rounded-tag bg-sunk type-body font-medium active:bg-line">
            {letterLabel(letter)}
          </Link>
        ) : (
          <span key={letter} aria-hidden="true" className="flex h-11 items-center justify-center type-body text-faint">
            {letterLabel(letter)}
          </span>
        ),
      )}
    </nav>
  );
}

/** One card of employers, rows split by hairlines: tile, name, places, open jobs. */
export function EmployerList({ rows }: { rows: EmployerRow[] }) {
  return (
    <ul className="m-0 list-none overflow-hidden rounded-card bg-surface p-0 shadow-lift">
      {rows.map((row) => (
        <li key={row.slug} className="border-t border-line first:border-t-0">
          <Link href={`/companies/${row.slug}`} className="flex min-h-16 items-center gap-3 px-3.5 py-3 active:bg-sunk">
            <CompanyMark name={row.name} logoUrl={row.logoUrl} size={40} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate type-body font-semibold" title={row.name}>
                {row.name}
              </span>
              {row.places ? (
                <span className="truncate type-meta text-muted-foreground" title={row.places}>
                  {row.places}
                </span>
              ) : null}
            </span>
            <span className="flex-none type-body font-medium tabular-nums">{row.openJobs.toLocaleString("en-IN")}</span>
            <Icon name="chevronRight" size={16} className="flex-none text-faint" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

const where = (job: EmployerJobRow) => {
  const place = job.location || "Location not listed";
  return job.remoteType === "remote" && !/remote/i.test(place) ? `${place}, remote` : place;
};

/**
 * One card of jobs: title, place and age. Each opens the job's own page, where Apply is; while share pages are switched
 * off (`linked` false) the rows are plain text, not links to a 404.
 */
export function JobList({ jobs, linked }: { jobs: EmployerJobRow[]; linked: boolean }) {
  return (
    <ul className="m-0 list-none overflow-hidden rounded-card bg-surface p-0 shadow-lift">
      {jobs.map((job) => {
        const body = (
          <>
            <span className="flex items-start gap-3">
              <span className="line-clamp-2 min-w-0 flex-1 type-body font-medium" title={job.title}>
                {job.title}
              </span>
              {linked ? <Icon name="chevronRight" size={16} className="mt-1 flex-none text-faint" /> : null}
            </span>
            <span className="truncate type-meta text-muted-foreground">
              {where(job)}, {postedLabel(daysSince(job.postedAt)).replace(/^Posted /, "")}
            </span>
          </>
        );
        return (
          <li key={job.id} className="border-t border-line first:border-t-0">
            {linked ? (
              <Link href={`${jobPath({ id: job.id, title: job.title, company: { name: job.companyName } })}?s=co`} className="flex min-h-16 flex-col gap-1 px-3.5 py-3 active:bg-sunk">
                {body}
              </Link>
            ) : (
              <div className="flex min-h-16 flex-col gap-1 px-3.5 py-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** "In India 38": a heading with its count. */
export function CountHeading({ children, count }: { children: ReactNode; count: number }) {
  return (
    <h2 className="m-0 mb-2.5 flex items-baseline justify-between gap-2 type-section">
      {children}
      <span className="type-meta font-normal text-muted-foreground">{count.toLocaleString("en-IN")}</span>
    </h2>
  );
}

/** Previous and next page links under a list; nothing for one page. */
export function Pager({ base, page, pages }: { base: string; page: number; pages: number }) {
  if (pages <= 1) return null;
  const href = (n: number) => (n <= 1 ? base : `${base}?page=${n}`);
  return (
    <div className="mt-3 flex items-center justify-between">
      {page > 1 ? (
        <Link href={href(page - 1)} className="flex min-h-11 items-center type-body underline decoration-1 underline-offset-4">
          Previous page
        </Link>
      ) : (
        <span />
      )}
      <span className="type-meta text-muted-foreground tabular-nums">
        {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className="flex min-h-11 items-center type-body underline decoration-1 underline-offset-4">
          Next page
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}

/** The sticky bottom bar of a company page: the one action, which starts the agent. */
export function ApplyBar() {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 mt-8 border-t border-line bg-background/90 px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] backdrop-blur-md">
      <Link href="/sign-in" className={cn(buttonVariants({ variant: "primary", size: "xl" }), "w-full")}>
        Let your agent apply
      </Link>
      <p className="m-0 mt-2 text-center type-meta text-muted-foreground">Upload your resume once. Your agent fills in the forms and sends them.</p>
    </div>
  );
}
