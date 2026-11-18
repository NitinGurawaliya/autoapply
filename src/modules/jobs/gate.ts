import { classifyTitle } from "./functions";

/**
 * One gate for the feed, the score and the swipe check (Phase P, docs/relevance/TDD.md 4.1.4). Pure functions: P1 adds
 * them unused (P2's eval needs them); P3 adds the SQL mirror in feedRows and calls jobGate from scoreFeatures and
 * candidateScore, so the card, the score and the swipe check agree.
 */

/** What the gate needs of a job: its title track and, when read, the reading's columns. */
export type GateJob = {
  source: string;
  title: string;
  /** Job.track (classifyTitle at ingest); recomputed from the title when not given. */
  track?: string | null;
  roleFamily?: string | null;
  kind?: string | null;
  flags?: string[] | null;
  readingCurrent?: boolean | null;
};

/** The "Never show me" chips (P4): each value and what it removes. */
export const AVOIDS = ["contract", "intern", "commission_only"] as const;
export type Avoid = (typeof AVOIDS)[number];

const current = (job: GateJob) => job.readingCurrent === true;

/**
 * The job's family: the reading's roleFamily when the reading is current and names one, else the title's track
 * ("non_tech" for a title classifyTitle calls non-tech).
 */
export function trackOf(job: GateJob): string | null {
  if (current(job) && job.roleFamily) return job.roleFamily;
  if (job.track) return job.track;
  const title = classifyTitle(job.title);
  return title.function === "non_tech" ? "non_tech" : title.track;
}

export type GateResult = { pass: true } | { pass: false; rule: "field" | "non_tech" | "gig" | "task" | "paid_task" | `avoid_${Avoid}` };

/**
 * Whether a job may be shown or applied to. `tracks` is the effective list the feed used (the Track filter's picks,
 * else feedTracks); null skips the field part. `field: false` (the swipe check, which cannot know the Track filter the
 * card was shown under) enforces non-tech, gig, task, paid task and avoid only. Mock jobs always pass. Kind and flags
 * count only from a current reading.
 */
export function jobGate(job: GateJob, who: { tracks: string[] | null; avoid?: readonly string[] | null }, options: { field: boolean }): GateResult {
  if (job.source === "mock") return { pass: true };
  const family = trackOf(job);
  if (family === "non_tech") return { pass: false, rule: "non_tech" };
  if (options.field && who.tracks && !(family && who.tracks.includes(family))) return { pass: false, rule: "field" };
  const kind = current(job) ? job.kind : null;
  const flags = current(job) ? (job.flags ?? []) : [];
  if (kind === "gig") return { pass: false, rule: "gig" };
  if (kind === "task") return { pass: false, rule: "task" };
  if (flags.includes("paid_task")) return { pass: false, rule: "paid_task" };
  const avoid = who.avoid ?? [];
  if (avoid.includes("contract") && kind === "contract") return { pass: false, rule: "avoid_contract" };
  if (avoid.includes("intern") && kind === "intern") return { pass: false, rule: "avoid_intern" };
  if (avoid.includes("commission_only") && flags.includes("commission_only")) return { pass: false, rule: "avoid_commission_only" };
  return { pass: true };
}
