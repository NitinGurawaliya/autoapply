import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "cn";
import { Icon } from "@/components/ui/icons";
import { CompanyMark } from "@/components/ui/marks";
export { JsonLd } from "@/components/patterns/json-ld";
import type { DepartmentId } from "@/lib/department";
import { LETTERS, type EmployerFilters, type EmployerRow } from "@/modules/jobs/employer-pages";

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

/** "In India 38": a heading with its count. */
export function CountHeading({ children, count }: { children: ReactNode; count: number }) {
  return (
    <h2 className="m-0 mb-3 flex items-baseline justify-between gap-2 type-section">
      {children}
      <span className="type-label text-muted-foreground">{count.toLocaleString("en-IN")} {count === 1 ? "role" : "roles"}</span>
    </h2>
  );
}

/** The address of a company page with its search and department (and a page number past the first). */
export function companyHref(slug: string, filters: EmployerFilters, page = 1): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.department) params.set("f", filters.department);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/companies/${slug}${query ? `?${query}` : ""}`;
}

/**
 * The department chips with their counts (a filter, so they are pills, the selected one filled) and a search of this
 * company's jobs. Plain links and a GET form: they work without scripts and a filtered page has its own address.
 */
export function Filters({ slug, name, departments, all, filters }: { slug: string; name: string; departments: Array<{ id: DepartmentId; label: string; count: number }>; all: number; filters: EmployerFilters }) {
  const chip = (selected: boolean) =>
    cn(
      "inline-flex h-10 flex-none items-center gap-1.5 rounded-full px-3.5 type-body font-medium whitespace-nowrap active:bg-line",
      selected ? "bg-inverse text-inverse-foreground active:bg-inverse" : "bg-surface text-foreground ring-1 ring-input",
    );
  return (
    <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-4">
      <nav aria-label="Departments" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] lg:mx-0 lg:min-w-0 lg:flex-1 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
        <Link href={companyHref(slug, { ...filters, department: null })} className={chip(!filters.department)} aria-current={!filters.department ? "true" : undefined}>
          All <span className={cn("font-mono type-meta", !filters.department ? "opacity-70" : "text-muted-foreground")}>{all.toLocaleString("en-IN")}</span>
        </Link>
        {departments.map((department) => (
          <Link key={department.id} href={companyHref(slug, { ...filters, department: department.id })} className={chip(filters.department === department.id)} aria-current={filters.department === department.id ? "true" : undefined}>
            {department.label} <span className={cn("font-mono type-meta", filters.department === department.id ? "opacity-70" : "text-muted-foreground")}>{department.count.toLocaleString("en-IN")}</span>
          </Link>
        ))}
      </nav>
      <form method="get" action={`/companies/${slug}`} role="search" className="relative flex-none lg:w-72">
        {filters.department ? <input type="hidden" name="f" value={filters.department} /> : null}
        <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint" />
        <input
          type="search"
          name="q"
          defaultValue={filters.q}
          maxLength={80}
          placeholder={`Search ${name} jobs`}
          aria-label={`Search ${name} jobs`}
          enterKeyHint="search"
          className="h-11 w-full rounded-full bg-surface pr-4 pl-11 type-body text-foreground ring-1 ring-input placeholder:text-faint focus-visible:outline-2 focus-visible:outline-ring"
        />
      </form>
    </div>
  );
}

/** Previous and next page links under a list (`href` gives each page's address); nothing for one page. */
export function Pager({ href, page, pages }: { href: (page: number) => string; page: number; pages: number }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between">
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
