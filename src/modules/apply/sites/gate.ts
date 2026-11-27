import { db } from "@/lib/db";
import { sourceRules } from "@/modules/governance";
import { SITE_INFO, SITES, type Site } from "@/modules/sources/sites";
import { SUBMIT_ATTEMPT } from "../outcome";

// Applying through the user's own signed-in account (K4, docs/naukri/TDD.md 4.7, 4.8): which jobs apply on the site
// itself, and the checks before a swipe and before a run (the connection, the site's daily cap, the pace between
// applies). Database only, no browser; the swipe (lifecycle.ts) and the run (runner.ts) share it.

/** Sites whose own Apply the agent presses, through the user's own account. */
export const SIGNED_IN_APPLY_SITES: readonly Site[] = SITES;
export type SignedInApplySite = Site;

const LABEL: Record<SignedInApplySite, string> = Object.fromEntries(SITES.map((site) => [site, SITE_INFO[site].label])) as Record<SignedInApplySite, string>;

export function isSignedInApplySite(source: string): source is SignedInApplySite {
  return (SIGNED_IN_APPLY_SITES as readonly string[]).includes(source);
}

export type SiteRefusal = { rule: string; message: string };

/** The connection as a swipe or a run sees it; a pause that has run out counts as connected (the run lifts it). */
async function connectionRefusal(userId: string, site: SignedInApplySite, now: Date): Promise<SiteRefusal | null> {
  const label = LABEL[site];
  const row = await db.siteConnection.findUnique({ where: { userId_site: { userId, site } }, select: { status: true, pausedUntil: true } });
  if (!row || !["connected", "needs_signin", "limited"].includes(row.status)) return { rule: "source_not_connected", message: `Your ${label} account is not connected` };
  if (row.status === "needs_signin") return { rule: "source_needs_signin", message: `${label} signed you out; sign in again from Account` };
  if (row.status === "limited" && (!row.pausedUntil || row.pausedUntil > now)) {
    return { rule: "source_paused", message: `${label} is paused${row.pausedUntil ? ` until ${row.pausedUntil.toISOString()}` : ""} after it asked for a check` };
  }
  return null;
}

const midnightUtc = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/**
 * The user's applies on the site: how many were pressed today (UTC) and when the last one was, from the runs' own
 * submit_attempt events (one per application, whatever its outcome: a press is what the site counts).
 */
export async function siteApplies(userId: string, site: SignedInApplySite, now = new Date()) {
  const [row] = await db.$queryRaw<Array<{ today: number; last: Date | null }>>`
    SELECT count(DISTINCT e."applicationId") FILTER (WHERE e."createdAt" >= ${midnightUtc(now)})::int AS today, max(e."createdAt") AS last
    FROM "ApplicationEvent" e
    JOIN "Application" a ON a.id = e."applicationId"
    JOIN "Job" j ON j.id = a."jobId"
    WHERE a."userId" = ${userId} AND j.source = ${site} AND e.type = ${SUBMIT_ATTEMPT}`;
  return { today: row?.today ?? 0, last: row?.last ?? null };
}

/**
 * A right swipe on a job of a signed-in site, refused before anything is recorded (the job stays in the feed): the
 * account not usable, today's cap on the site reached, or a job the site sends to another board (not yet, K4c).
 */
export async function swipeRefusal(userId: string, job: { source: string; applyVia: string | null }, now = new Date()): Promise<SiteRefusal | null> {
  if (!isSignedInApplySite(job.source)) return null;
  const site = job.source;
  const rules = sourceRules(site);
  if (!rules || job.applyVia) return { rule: "board_not_supported", message: `This ${LABEL[site]} job applies on another site` };
  const refused = await connectionRefusal(userId, site, now);
  if (refused) return refused;
  const { today } = await siteApplies(userId, site, now);
  if (today >= rules.max_applies_per_day) return { rule: `max_applies_per_day_${site}`, message: `${today} applies on ${LABEL[site]} today (limit ${rules.max_applies_per_day})` };
  return null;
}

export type RunGate = { kind: "go" } | ({ kind: "block" } & SiteRefusal) | ({ kind: "wait"; seconds: number } & SiteRefusal);

/**
 * Before a run presses anything (inside the user's submit lock, so two runs cannot both pass): the connection, the
 * site's daily cap (wait for tomorrow, UTC) and the pace (at least min_minutes_between_applies since the last press,
 * plus a few seconds' jitter, so presses are never on a beat).
 */
export async function runGate(userId: string, site: SignedInApplySite, now = new Date(), jitter = Math.random): Promise<RunGate> {
  const rules = sourceRules(site);
  if (!rules) return { kind: "block", rule: "board_not_supported", message: `No rules for ${LABEL[site]} in config/rules.json` };
  const refused = await connectionRefusal(userId, site, now);
  if (refused) return { kind: "block", ...refused };
  const { today, last } = await siteApplies(userId, site, now);
  if (today >= rules.max_applies_per_day) {
    const tomorrow = midnightUtc(now).getTime() + 24 * 60 * 60 * 1000;
    const seconds = Math.ceil((tomorrow - now.getTime()) / 1000) + 60 + Math.round(jitter() * 600);
    return { kind: "wait", seconds, rule: `max_applies_per_day_${site}`, message: `${today} applies on ${LABEL[site]} today (limit ${rules.max_applies_per_day}): waiting until tomorrow (UTC)` };
  }
  const gapMs = rules.min_minutes_between_applies * 60 * 1000;
  if (last && now.getTime() - last.getTime() < gapMs) {
    const seconds = Math.ceil((gapMs - (now.getTime() - last.getTime())) / 1000) + 5 + Math.round(jitter() * 25);
    return { kind: "wait", seconds, rule: `min_minutes_between_applies_${site}`, message: `Waiting ${seconds} s: applies on ${LABEL[site]} are at least ${rules.min_minutes_between_applies} min apart` };
  }
  return { kind: "go" };
}
