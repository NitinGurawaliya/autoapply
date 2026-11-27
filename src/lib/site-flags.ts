import { SITES } from "@/modules/sources/sites";

/**
 * Which signed-in portals are switched on (docs/hirist/TDD.md 4.5): one set of env names per site, so a new portal is
 * one more entry in SITES and its three switches, not another hard-coded list.
 *
 *   feed    ENABLE_<SITE>=1                       its jobs show to users who connected it, and connecting is offered
 *   apply   ENABLE_<SITE>=1 and ENABLE_<SITE>_APPLY=1   a right swipe applies on it through the user's own account
 *   reader  <SITE>_READER=1                        this process works the shared reader for it (K14)
 */
export type SiteFlag = "feed" | "apply" | "reader";
type Env = Record<string, string | undefined>;

export function siteOn(site: string, flag: SiteFlag, env: Env = process.env): boolean {
  const name = site.toUpperCase();
  if (flag === "feed") return env[`ENABLE_${name}`] === "1";
  if (flag === "apply") return env[`ENABLE_${name}`] === "1" && env[`ENABLE_${name}_APPLY`] === "1";
  return env[`${name}_READER`] === "1";
}

/** Every site with the switch on, in SITES order. */
export function sitesOn(flag: SiteFlag, env: Env = process.env): string[] {
  return SITES.filter((site) => siteOn(site, flag, env));
}
