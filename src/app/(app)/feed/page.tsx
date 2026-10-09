import Link from "next/link";
import { SearchX } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { APPLY_BOARDS, listFeed, parseFeedFilters } from "@/modules/jobs";
import { redirect } from "next/navigation";
import { DailyUsage } from "@/components/daily-usage";
import { FilterSheet } from "./filter-sheet";
import { SwipeDeck } from "./swipe-deck";

const BOARDS = [
  { id: "greenhouse", label: "Greenhouse" },
  { id: "lever", label: "Lever" },
  { id: "ashby", label: "Ashby" },
].filter((board) => (APPLY_BOARDS as readonly string[]).includes(board.id));

const COUNTRIES = [
  { id: "IN", label: "India" },
  { id: "REMOTE", label: "Remote" },
  { id: "US", label: "US" },
  { id: "OTHER", label: "Other" },
] as const;

const EXPERIENCE = [
  { id: "", label: "Any experience" },
  { id: "3", label: "Up to 3 years" },
  { id: "5", label: "Up to 5 years" },
  { id: "10", label: "Up to 10 years" },
] as const;

const WINDOWS = [
  { id: "1", label: "Last day" },
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
] as const;

type Query = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function href(current: FeedQuery, patch: Partial<FeedQuery>) {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.boards.length > 0 && next.boards.length < BOARDS.length) params.set("boards", next.boards.join(","));
  if (next.countries.length > 0 && next.countries.length < COUNTRIES.length) {
    params.set("country", next.countries.join(","));
  }
  if (next.expMax) params.set("expMax", next.expMax);
  if (next.days !== "30") params.set("days", next.days);
  const query = params.toString();
  return query ? `/feed?${query}` : "/feed";
}

function toggle(list: string[], id: string, all: string[]) {
  if (list.length === all.length) return [id];
  const next = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  return next.length === 0 ? all : next;
}

type FeedQuery = { boards: string[]; countries: string[]; expMax: string; days: string };

function Chip({ href: to, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <a
      href={to}
      aria-current={active ? "true" : undefined}
      className={
        active
          ? "rounded-full border border-primary bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground"
          : "rounded-full border border-border bg-card px-3.5 py-1.5 text-sm transition-colors hover:bg-accent/50"
      }
    >
      {children}
    </a>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

export default async function FeedPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const params = await searchParams;
  const filters = parseFeedFilters({
    boards: one(params.boards),
    country: one(params.country),
    expMax: one(params.expMax),
    days: one(params.days),
  });
  const jobs = await listFeed(user.id, filters);
  const current: FeedQuery = {
    boards: filters.boards,
    countries: filters.countries,
    expMax: filters.expMax == null ? "" : String(filters.expMax),
    days: String(filters.days),
  };

  // What is narrowing the feed right now, in plain words.
  const active: string[] = [];
  if (BOARDS.length > 1 && current.boards.length < BOARDS.length) {
    active.push(BOARDS.filter((board) => current.boards.includes(board.id)).map((board) => board.label).join(", "));
  }
  if (current.countries.length < COUNTRIES.length) {
    active.push(COUNTRIES.filter((country) => current.countries.includes(country.id)).map((country) => country.label).join(", "));
  }
  if (current.expMax) active.push(EXPERIENCE.find((band) => band.id === current.expMax)?.label ?? `Up to ${current.expMax} years`);
  if (current.days !== "30") active.push(WINDOWS.find((window) => window.id === current.days)?.label ?? `Last ${current.days} days`);

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Feed</h1>
          <p className="mt-1 text-sm text-muted-foreground">Jobs that match your profile.</p>
          <div className="mt-2">
            <DailyUsage userId={user.id} />
          </div>
        </div>
        <FilterSheet activeCount={active.length}>
          {BOARDS.length > 1 ? (
            <Section title="Job boards">
              {BOARDS.map((board) => (
                <Chip
                  key={board.id}
                  active={current.boards.includes(board.id)}
                  href={href(current, { boards: toggle(current.boards, board.id, BOARDS.map((item) => item.id)) })}
                >
                  {board.label}
                </Chip>
              ))}
            </Section>
          ) : null}
          <Section title="Where">
            {COUNTRIES.map((country) => (
              <Chip
                key={country.id}
                active={current.countries.includes(country.id)}
                href={href(current, { countries: toggle(current.countries, country.id, COUNTRIES.map((item) => item.id)) })}
              >
                {country.label}
              </Chip>
            ))}
          </Section>
          <Section title="Experience asked">
            {EXPERIENCE.map((band) => (
              <Chip key={band.id || "any"} active={current.expMax === band.id} href={href(current, { expMax: band.id })}>
                {band.label}
              </Chip>
            ))}
          </Section>
          <Section title="Posted">
            {WINDOWS.map((window) => (
              <Chip key={window.id} active={current.days === window.id} href={href(current, { days: window.id })}>
                {window.label}
              </Chip>
            ))}
          </Section>
          {active.length > 0 ? (
            <Link href="/feed" className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline">
              Clear all filters
            </Link>
          ) : null}
        </FilterSheet>
      </div>

      {active.length > 0 ? (
        <div className="-mt-2 flex flex-wrap items-center gap-2" aria-label="Active filters">
          {active.map((label) => (
            <span key={label} className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
              {label}
            </span>
          ))}
          <Link href="/feed" className="text-xs text-muted-foreground underline underline-offset-4">
            Reset
          </Link>
        </div>
      ) : null}

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-card">
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <SearchX className="size-6" aria-hidden />
          </span>
          <h2 className="text-base font-semibold">No jobs match these filters</h2>
          <p className="max-w-[30ch] text-sm text-muted-foreground">
            {active.length > 0
              ? "Try a wider search: more places, any experience, or the last 30 days."
              : "Jobs you have not applied to yet will show up here as companies post them."}
          </p>
          {active.length > 0 ? (
            <Link href="/feed" className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Reset filters
            </Link>
          ) : (
            <Link href="/applications" className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              See your applications
            </Link>
          )}
        </div>
      ) : (
        <SwipeDeck
          jobs={jobs}
          query={new URLSearchParams({
            boards: current.boards.join(","),
            country: current.countries.join(","),
            expMax: current.expMax,
            days: current.days,
          }).toString()}
        />
      )}
    </>
  );
}
