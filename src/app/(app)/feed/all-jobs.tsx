import Link from "next/link";
import { BROWSE_DAYS, BROWSE_EXP, BROWSE_STAGES, browseHref, DEFAULT_BROWSE, widened, type BrowseFilters } from "@/lib/browse-url";
import { browseJobs, TRACK_LABELS, TRACKS, type BrowseCard } from "@/modules/jobs";
import type { Track } from "@/modules/jobs";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/eyebrow";
import { Icon } from "@/components/ui/icons";
import { CompanyMark } from "@/components/ui/marks";
import { ChipGroup } from "@/components/patterns/chip-group";
import { EmptyState } from "@/components/patterns/content";
import { DeckEmptyArt } from "@/components/patterns/drawings";
import { BrowseApply } from "./browse-apply";
import { FilterSheet } from "./filter-sheet";

// All jobs (Phase X, docs/feed/TDD.md 4.3 and 5): every open job the filters find, 25 a page, each card saying whether
// it matches the person's profile and, if not, why. Only a matching job has Apply (owner, 27 Nov). Filters are links
// and one GET search form, like the deck's, so the address is the whole state.

const PLACES = [
  { id: "IN", label: "In India" },
  { id: "REMOTE", label: "Remote (open to India)" },
  { id: "US", label: "US" },
  { id: "OTHER", label: "Other countries" },
] as const;
const STAGE_LABEL: Record<(typeof BROWSE_STAGES)[number], string> = { startup: "Startup", midsize: "Mid-size", mnc: "MNC" };
const DAY_LABEL: Record<(typeof BROWSE_DAYS)[number], string> = { 1: "Last day", 7: "Last 7 days", 30: "Last 30 days", 60: "Any open job" };

const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);

/** The filter sheet's chips: each a link to All jobs with that one choice changed (back to page 1). */
export function BrowseFilterSheet({ filters, myTracks }: { filters: BrowseFilters; myTracks: string[] }) {
  const to = (patch: Partial<BrowseFilters>) => browseHref({ ...filters, ...patch });
  const active = [filters.exp !== "profile", filters.field !== "profile", filters.countries.join(",") !== DEFAULT_BROWSE.countries.join(","), filters.stages.length > 0, filters.days !== DEFAULT_BROWSE.days, filters.pay, filters.skipped].filter(Boolean).length;
  const others = TRACKS.filter((track) => !myTracks.includes(track));
  return (
    <FilterSheet activeCount={active} resetHref={browseHref({ ...DEFAULT_BROWSE, q: filters.q, sort: filters.sort })}>
      <ChipGroup
        className="mt-4"
        legend="Field"
        options={[
          { key: "profile", label: "My fields", selected: filters.field === "profile", href: to({ field: "profile" }) },
          { key: "all", label: "Every tech field", selected: filters.field === "all", href: to({ field: "all" }) },
          ...[...myTracks, ...others].map((track) => ({ key: track, label: TRACK_LABELS[track as Track] ?? track, selected: filters.field === track, href: to({ field: track }) })),
        ]}
      />
      <ChipGroup
        className="mt-4"
        legend="Experience they ask for"
        options={[
          { key: "profile", label: "Fits my years", selected: filters.exp === "profile", href: to({ exp: "profile" }) },
          ...BROWSE_EXP.map((years) => ({ key: String(years), label: `Up to ${years} ${years === 1 ? "year" : "years"}`, selected: filters.exp === years, href: to({ exp: years }) })),
          { key: "any", label: "Any", selected: filters.exp === "any", href: to({ exp: "any" }) },
        ]}
      />
      <ChipGroup
        className="mt-4"
        legend="Location"
        options={PLACES.map((place) => {
          const next = flip(filters.countries, place.id);
          return { label: place.label, selected: filters.countries.includes(place.id), href: to({ countries: next.length > 0 ? next : DEFAULT_BROWSE.countries }) };
        })}
      />
      <ChipGroup className="mt-4" legend="Company type" options={BROWSE_STAGES.map((stage) => ({ label: STAGE_LABEL[stage], selected: filters.stages.includes(stage), href: to({ stages: flip(filters.stages, stage) }) }))} />
      <ChipGroup className="mt-4" legend="Posted" options={BROWSE_DAYS.map((days) => ({ label: DAY_LABEL[days], selected: filters.days === days, href: to({ days }) }))} />
      <ChipGroup
        className="mt-4"
        legend="Also"
        options={[
          { key: "pay", label: "States pay", selected: filters.pay, href: to({ pay: !filters.pay }) },
          { key: "skipped", label: "Include jobs I skipped", selected: filters.skipped, href: to({ skipped: !filters.skipped }) },
        ]}
      />
    </FilterSheet>
  );
}

/** Today's picks | All jobs: two links, the current one filled. */
export function FeedModeSwitch({ mode, picksHref }: { mode: "picks" | "all"; picksHref: string }) {
  const tab = (selected: boolean) =>
    `flex h-9 flex-1 items-center justify-center rounded-control type-body font-semibold no-underline ${selected ? "bg-inverse text-inverse-foreground" : "text-muted-foreground active:text-foreground"}`;
  return (
    <nav aria-label="Feed" className="mx-5 mt-3 flex rounded-control p-1 ring-1 ring-line">
      <Link href={picksHref} aria-current={mode === "picks" ? "page" : undefined} className={tab(mode === "picks")}>
        Today&apos;s picks
      </Link>
      <Link href={browseHref(DEFAULT_BROWSE)} aria-current={mode === "all" ? "page" : undefined} className={tab(mode === "all")}>
        All jobs
      </Link>
    </nav>
  );
}

/** The search line and the order, above the list (a GET form, so it works before the page's script loads). */
export function BrowseSearch({ filters }: { filters: BrowseFilters }) {
  const keep = { ...filters, q: "", sort: "match" as const };
  const hidden = Object.fromEntries(new URL(browseHref(keep), "http://x").searchParams);
  return (
    <form action="/feed" method="get" role="search" className="mx-5 mt-3 flex flex-col gap-2">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="flex gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-control bg-surface px-3 ring-1 ring-line-strong focus-within:ring-2 focus-within:ring-ring">
          <Icon name="search" size={18} />
          <span className="sr-only">Role or skill</span>
          <input name="q" type="search" defaultValue={filters.q} placeholder="Role or skill, e.g. react" className="min-w-0 flex-1 bg-transparent type-body outline-none placeholder:text-faint" />
        </label>
        <label className="sr-only" htmlFor="browse-sort">
          Order
        </label>
        <select id="browse-sort" name="sort" defaultValue={filters.sort} className="h-11 flex-none rounded-control bg-surface px-3 type-body ring-1 ring-line-strong">
          <option value="match">Best match</option>
          <option value="new">Newest</option>
        </select>
        <button type="submit" className={buttonVariants({ variant: "line", size: "md" })}>
          Go
        </button>
      </div>
    </form>
  );
}

function facts(job: BrowseCard) {
  const place = job.remoteType === "remote" ? "Remote" : job.location || null;
  const years = job.requiredYears != null ? `${job.requiredYears}+ yrs` : null;
  const posted = job.daysAgo <= 0 ? "Today" : `${job.daysAgo}d ago`;
  return [place, years, posted].filter(Boolean).join(" · ");
}

function BrowseJobCard({ job }: { job: BrowseCard }) {
  const { fit } = job;
  return (
    <li className="rounded-card bg-surface p-4 ring-1 ring-line">
      <div className="flex gap-3">
        <CompanyMark name={job.company} logoUrl={job.logoUrl} size={44} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2 type-meta text-muted-foreground">
            <span className="truncate font-semibold text-foreground">{job.company}</span>
            {job.isNew ? <span className="flex-none text-brand-text">New</span> : null}
          </span>
          <h3 className="m-0 line-clamp-2 type-section text-balance">
            <Link href={`/jobs/${job.id}`} className="text-foreground no-underline hover:underline hover:underline-offset-4">
              {job.title}
            </Link>
          </h3>
          <p className="m-0 type-meta text-muted-foreground">
            {facts(job)}
            {job.salary ? <span className="ml-2 font-mono text-foreground">{job.salary}</span> : null}
          </p>
        </div>
        {fit.score != null ? (
          <span className="flex flex-none flex-col items-end">
            <span className={`type-heading tabular-nums ${fit.matches ? "text-brand-text" : "text-muted-foreground"}`}>{fit.score}</span>
            <span className="type-meta text-muted-foreground">match</span>
          </span>
        ) : null}
      </div>
      {fit.matches ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 type-meta font-semibold text-foreground">
            <Icon name="check" size={16} />
            Matches your profile
          </span>
          <BrowseApply jobId={job.id} company={job.company} />
        </div>
      ) : (
        <div className="mt-3 rounded-control border border-dashed border-dash px-3 py-2.5">
          <p className="m-0 type-meta font-semibold text-foreground">Doesn&apos;t match your profile: don&apos;t apply</p>
          {fit.reasons.length > 0 ? (
            <ul className="m-0 mt-1 list-none p-0 type-meta text-muted-foreground">
              {fit.reasons.slice(0, 3).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </li>
  );
}

/** The list itself, streamed in under the search and the switch. */
export async function AllJobsList({ userId, filters, page }: { userId: string; filters: BrowseFilters; page: number }) {
  const result = await browseJobs(userId, filters, page);
  if (result.total === 0) {
    return (
      <EmptyState
        headingLevel="h2"
        art={<DeckEmptyArt />}
        title="No jobs found"
        text={
          widened(filters) || filters.q
            ? "Nothing open matches this search. Try another word, or a wider field or experience in Filters."
            : "Nothing open in your fields and years right now. Widen the field or experience in Filters to see more, each marked against your profile."
        }
        actions={
          <Link href={browseHref({ ...DEFAULT_BROWSE, field: "all", exp: "any" })} className={buttonVariants({ variant: "line", size: "lg", className: "w-full" })}>
            Show every tech job
          </Link>
        }
      />
    );
  }
  const matching = result.jobs.filter((job) => job.fit.matches).length;
  return (
    <section aria-label="All jobs" className="px-5 pt-3 pb-6">
      <p className="m-0 type-meta text-muted-foreground">
        {result.total.toLocaleString("en-IN")} {result.total === 1 ? "job" : "jobs"}
        {widened(filters) ? null : " in your fields and years"} · {matching} of these {result.jobs.length} match your profile
      </p>
      <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
        {result.jobs.map((job) => (
          <BrowseJobCard key={job.id} job={job} />
        ))}
      </ul>
      {result.pages > 1 ? (
        <nav aria-label="Pages" className="mt-5 flex items-center justify-between gap-3">
          {result.page > 1 ? (
            <Link href={browseHref(filters, result.page - 1)} className={buttonVariants({ variant: "line", size: "md" })}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="type-meta text-muted-foreground tabular-nums">
            Page {result.page} of {result.pages}
          </span>
          {result.page < result.pages ? (
            <Link href={browseHref(filters, result.page + 1)} className={buttonVariants({ variant: "line", size: "md" })}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </section>
  );
}

export function AllJobsSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-5 pt-3" aria-busy="true" aria-label="Loading jobs">
      <Skeleton className="h-4 w-48" />
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-36 w-full rounded-card" />
      ))}
    </div>
  );
}
