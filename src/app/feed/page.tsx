import { getCurrentUser } from "@/lib/auth";
import { SignOutForm } from "@/components/sign-out-form";
import { APPLY_BOARDS, listFeed, parseFeedFilters } from "@/modules/jobs";
import { redirect } from "next/navigation";
import { NeedsInputDialog } from "@/components/needs-input-dialog";
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
  { id: "1", label: "1 day" },
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
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
          ? "rounded-full border border-primary bg-primary px-3 py-1 text-xs text-primary-foreground"
          : "rounded-full border border-border px-3 py-1 text-xs"
      }
    >
      {children}
    </a>
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

  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Feed</h1>
        <p className="mt-1 text-sm text-muted-foreground">Jobs that match your profile.</p>
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {BOARDS.map((board) => (
            <Chip
              key={board.id}
              active={current.boards.includes(board.id)}
              href={href(current, { boards: toggle(current.boards, board.id, BOARDS.map((item) => item.id)) })}
            >
              {board.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {COUNTRIES.map((country) => (
            <Chip
              key={country.id}
              active={current.countries.includes(country.id)}
              href={href(current, {
                countries: toggle(current.countries, country.id, COUNTRIES.map((item) => item.id)),
              })}
            >
              {country.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {EXPERIENCE.map((band) => (
            <Chip key={band.id || "any"} active={current.expMax === band.id} href={href(current, { expMax: band.id })}>
              {band.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {WINDOWS.map((window) => (
            <Chip key={window.id} active={current.days === window.id} href={href(current, { days: window.id })}>
              {window.label}
            </Chip>
          ))}
        </div>
      </div>
      {jobs.length === 0 ? (
        <p className="rounded-lg border border-border px-3 py-6 text-sm text-muted-foreground">
          No jobs match these filters.
        </p>
      ) : (
        <SwipeDeck jobs={jobs} />
      )}
      <NeedsInputDialog />
      <SignOutForm />
    </main>
  );
}
