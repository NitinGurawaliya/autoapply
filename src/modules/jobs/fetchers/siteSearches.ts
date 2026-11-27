import { planSearches } from "./naukri";
import type { SiteSearch } from "./siteListing";

/**
 * How each site turns a user's profile into searches (docs/hirist/TDD.md 4.1). Pure, so the bucket planner
 * (modules/sources/reader.ts) and a site's driver (modules/apply/sites/drivers.ts) share it without the planner ever
 * loading a browser. A check's own site ("naukri-smoke") plans as its site.
 */
export type SearchInput = { tracks: string[]; currentTitle: string | null; city: string | null; yearsExperience: number | null };
export type SearchPlanner = (input: SearchInput, limit: number) => SiteSearch[];

const PLANNERS: Record<string, SearchPlanner> = { naukri: planSearches };

export function plannerOf(site: string): SearchPlanner {
  const planner = PLANNERS[site] ?? PLANNERS[site.split("-")[0]];
  if (!planner) throw new Error(`no search planner for ${site}`);
  return planner;
}

export function registerPlanner(site: string, planner: SearchPlanner) {
  PLANNERS[site] = planner;
}
