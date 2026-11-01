// The one way to write a feed URL. The feed's chips, its deck (and the job pages it opens) and the job page's Back all
// build it here, so Back lands on the very URL the user left and the browser's router cache can reuse that page.
// Free of server code so client components can use it too: the defaults come in from the caller, because the boards
// the agent applies on depend on the server's env (modules/jobs/match.ts APPLY_BOARDS).
import type { FeedFilters } from "@/modules/jobs";

export type FeedDefaults = {
  /** Every board the feed serves (APPLY_BOARDS): all of them means no `boards` param. */
  boards: readonly string[];
  /** DEFAULT_PLACES: these places mean no `country` param. */
  places: readonly string[];
  /** DEFAULT_FEED_DAYS: this window means no `days` param. */
  days: number;
};

function sameSet(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((item) => b.includes(item));
}

/** "/feed" for the defaults, else "/feed?…" with only the params that differ from them, always in the same order. */
export function feedHref(filters: FeedFilters, defaults: FeedDefaults): string {
  const params = new URLSearchParams();
  if (filters.boards.length > 0 && filters.boards.length < defaults.boards.length) params.set("boards", filters.boards.join(","));
  if (filters.countries.length > 0 && !sameSet(filters.countries, defaults.places)) params.set("country", filters.countries.join(","));
  if (filters.level !== "any") params.set("level", filters.level);
  if (filters.stages.length > 0) params.set("stage", filters.stages.join(","));
  if (filters.tracks.length > 0) params.set("track", filters.tracks.join(","));
  if (filters.expMax != null) params.set("expMax", String(filters.expMax));
  if (filters.days !== defaults.days) params.set("days", String(filters.days));
  const query = params.toString();
  return query ? `/feed?${query}` : "/feed";
}

/** The query part alone ("" for the defaults): what the deck passes to /api/jobs and to the job pages it opens. */
export function feedQuery(filters: FeedFilters, defaults: FeedDefaults): string {
  return feedHref(filters, defaults).split("?")[1] ?? "";
}
