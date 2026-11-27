// All jobs (Phase X, docs/feed/TDD.md 4.3): its filters in the address and back. Pure, so the server page and the
// client filter controls build the same links. Every filter the person leaves at its default stays out of the address.

export const BROWSE_PLACES = ["IN", "REMOTE", "US", "OTHER"] as const;
export const BROWSE_STAGES = ["startup", "midsize", "mnc"] as const;
export const BROWSE_DAYS = [1, 7, 30, 60] as const;
export const BROWSE_EXP = [1, 2, 3, 5, 10] as const;

export type BrowseFilters = {
  /** A role or skill to find. */
  q: string;
  /** Years the job may ask: "profile" = the person's own band, "any", or up to a number. */
  exp: "profile" | "any" | number;
  /** "profile" = the person's own fields, "all" = every tech field, else one field (a track id). */
  field: string;
  countries: string[];
  stages: string[];
  days: number;
  /** Only jobs whose board states pay. */
  pay: boolean;
  /** Jobs swiped left come back too. */
  skipped: boolean;
  sort: "match" | "new";
};

export const DEFAULT_BROWSE: BrowseFilters = { q: "", exp: "profile", field: "profile", countries: ["IN", "REMOTE"], stages: [], days: 60, pay: false, skipped: false, sort: "match" };

type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const list = (value: string | string[] | undefined, allowed: readonly string[]) =>
  one(value)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => allowed.includes(item));

export function parseBrowseFilters(query: Query, tracks: readonly string[]): BrowseFilters {
  const exp = one(query.exp);
  const field = one(query.field);
  const days = Number(one(query.days));
  const countries = list(query.place, BROWSE_PLACES);
  return {
    q: one(query.q).replace(/\s+/g, " ").trim().slice(0, 60),
    exp: exp === "any" ? "any" : (BROWSE_EXP as readonly number[]).includes(Number(exp)) ? Number(exp) : "profile",
    field: field === "all" || tracks.includes(field) ? field : "profile",
    countries: countries.length > 0 ? countries : DEFAULT_BROWSE.countries,
    stages: list(query.stage, BROWSE_STAGES),
    days: (BROWSE_DAYS as readonly number[]).includes(days) ? days : DEFAULT_BROWSE.days,
    pay: one(query.pay) === "1",
    skipped: one(query.skipped) === "1",
    sort: one(query.sort) === "new" ? "new" : "match",
  };
}

/** Whether the person widened past their profile (years or fields): those jobs are judged against it on the card. */
export function widened(filters: BrowseFilters) {
  return filters.exp !== "profile" || filters.field !== "profile";
}

/** The All jobs address for these filters and page. */
export function browseHref(filters: BrowseFilters, page = 1): string {
  const params = new URLSearchParams({ mode: "all" });
  if (filters.q) params.set("q", filters.q);
  if (filters.exp !== "profile") params.set("exp", String(filters.exp));
  if (filters.field !== "profile") params.set("field", filters.field);
  if (filters.countries.join(",") !== DEFAULT_BROWSE.countries.join(",")) params.set("place", filters.countries.join(","));
  if (filters.stages.length > 0) params.set("stage", filters.stages.join(","));
  if (filters.days !== DEFAULT_BROWSE.days) params.set("days", String(filters.days));
  if (filters.pay) params.set("pay", "1");
  if (filters.skipped) params.set("skipped", "1");
  if (filters.sort === "new") params.set("sort", "new");
  if (page > 1) params.set("page", String(page));
  return `/feed?${params.toString()}`;
}
