import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dailyUsage } from "@/modules/governance";
import { APPLY_BOARDS, listFeed, parseFeedFilters } from "@/modules/jobs";
import type { FeedFilters } from "@/modules/jobs";
import { DailyUsage } from "@/components/daily-usage";
import { GapsLink } from "@/components/gaps-link";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/eyebrow";
import { Icon } from "@/components/ui/icons";
import { ChipGroup } from "@/components/patterns/chip-group";
import { EmptyState } from "@/components/patterns/content";
import { DeckEmptyArt } from "@/components/patterns/drawings";
import { FeedTopBar } from "@/components/patterns/top-bar";
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
type ActiveFilter = { label: string; removeHref: string };

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
  const current: FeedQuery = {
    boards: filters.boards,
    countries: filters.countries,
    expMax: filters.expMax == null ? "" : String(filters.expMax),
    days: String(filters.days),
  };

  const deckQuery = new URLSearchParams({
    boards: current.boards.join(","),
    country: current.countries.join(","),
    expMax: current.expMax,
    days: current.days,
  }).toString();

  // What is narrowing the feed right now, in plain words, and the link that drops each one.
  const active: ActiveFilter[] = [];
  if (BOARDS.length > 1 && current.boards.length < BOARDS.length) {
    active.push({
      label: BOARDS.filter((board) => current.boards.includes(board.id)).map((board) => board.label).join(", "),
      removeHref: href(current, { boards: BOARDS.map((board) => board.id) }),
    });
  }
  if (current.countries.length < COUNTRIES.length) {
    active.push({
      label: COUNTRIES.filter((country) => current.countries.includes(country.id)).map((country) => country.label).join(", "),
      removeHref: href(current, { countries: COUNTRIES.map((country) => country.id) }),
    });
  }
  if (current.expMax) {
    active.push({
      label: EXPERIENCE.find((band) => band.id === current.expMax)?.label ?? `Up to ${current.expMax} years`,
      removeHref: href(current, { expMax: "" }),
    });
  }
  if (current.days !== "30") {
    active.push({
      label: WINDOWS.find((window) => window.id === current.days)?.label ?? `Last ${current.days} days`,
      removeHref: href(current, { days: "30" }),
    });
  }

  const groups = (
    <>
      {BOARDS.length > 1 ? (
        <ChipGroup
          className="mt-4"
          legend="Job boards"
          options={BOARDS.map((board) => ({
            label: board.label,
            selected: current.boards.includes(board.id),
            href: href(current, { boards: toggle(current.boards, board.id, BOARDS.map((item) => item.id)) }),
          }))}
        />
      ) : null}
      <ChipGroup
        className="mt-4"
        legend="Location"
        options={COUNTRIES.map((country) => ({
          label: country.label,
          selected: current.countries.includes(country.id),
          href: href(current, { countries: toggle(current.countries, country.id, COUNTRIES.map((item) => item.id)) }),
        }))}
      />
      <ChipGroup
        className="mt-4"
        legend="Experience they ask for"
        options={EXPERIENCE.map((band) => ({
          key: band.id || "any",
          label: band.label,
          selected: current.expMax === band.id,
          href: href(current, { expMax: band.id }),
        }))}
      />
      <ChipGroup
        className="mt-4"
        legend="Posted"
        options={WINDOWS.map((window) => ({ label: window.label, selected: current.days === window.id, href: href(current, { days: window.id }) }))}
      />
    </>
  );
  const sheet = (opener: "icon" | "edit" | "widen") => (
    <FilterSheet opener={opener} activeCount={active.length} resetHref="/feed">
      {groups}
    </FilterSheet>
  );

  return (
    <>
      <FeedTopBar usage={<DailyUsage userId={user.id} />} filters={sheet("icon")} />
      <Suspense fallback={null}>
        <GapsLine userId={user.id} />
      </Suspense>
      {/* The top bar and filters need only the URL; the cards stream in when the feed is scored. */}
      <Suspense key={deckQuery} fallback={<DeckSkeleton />}>
        <FeedDeck userId={user.id} filters={filters} active={active} query={deckQuery} editFilters={sheet("edit")} widenFilters={sheet("widen")} />
      </Suspense>
    </>
  );
}

async function GapsLine({ userId }: { userId: string }) {
  const link = await GapsLink({ userId });
  return link ? <div className="flex px-5 pt-2">{link}</div> : null;
}

function DeckSkeleton() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6 px-5 pb-2" aria-busy="true" aria-label="Loading jobs">
      <Skeleton className="mt-[18px] h-[420px] rounded-card" />
      <div className="flex items-center justify-center gap-8">
        <Skeleton className="size-16 rounded-full" />
        <Skeleton className="size-18 rounded-full" />
      </div>
    </div>
  );
}

async function FeedDeck({
  userId,
  filters,
  active,
  query,
  editFilters,
  widenFilters,
}: {
  userId: string;
  filters: FeedFilters;
  active: ActiveFilter[];
  query: string;
  editFilters: React.ReactNode;
  widenFilters: React.ReactNode;
}) {
  const [jobs, sentToday, inProgress] = await Promise.all([
    listFeed(userId, filters),
    dailyUsage(userId),
    db.application.count({ where: { userId, status: { in: ["queued", "inspecting", "filling"] } } }),
  ]);
  if (jobs.length > 0) return <SwipeDeck jobs={jobs} query={query} stats={{ sentToday, inProgress }} widenFilters={widenFilters} />;

  if (active.length > 0) {
    return (
      <EmptyState
        art={<DeckEmptyArt />}
        title="No jobs match these filters"
        text={
          active.length > 1
            ? "Each one is fine on its own. Together they're very narrow, so try removing one."
            : "Try a wider search: more places, any experience, or the last 30 days."
        }
        extra={active.map((filter) => (
          <a
            key={filter.label}
            href={filter.removeHref}
            aria-label={`Remove filter ${filter.label}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border-2 border-edge bg-surface pr-2.5 pl-3.5 text-sm font-semibold text-foreground no-underline"
          >
            {filter.label}
            <Icon name="closeSmall" size={16} strokeWidth={2.5} />
          </a>
        ))}
        actions={
          <>
            <a href="/feed" className={buttonVariants({ variant: "primary", size: "xl", className: "w-full" })}>
              Clear all filters
            </a>
            {editFilters}
          </>
        }
      />
    );
  }
  return (
    <EmptyState
      art={<DeckEmptyArt />}
      title="No jobs match these filters"
      text="Jobs you have not applied to yet will show up here as companies post them."
      actions={
        <Link href="/applications" className={buttonVariants({ variant: "primary", size: "xl", className: "w-full" })}>
          See my applications
        </Link>
      }
    />
  );
}
