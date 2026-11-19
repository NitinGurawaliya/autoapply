import { Prisma } from "@prisma/client";
import { classifyTitle } from "./functions";

/**
 * One gate for the feed, the score and the swipe check (Phase P, docs/relevance/TDD.md 4.1.4; the field rule is P2's
 * "title AND reading", ARCHITECTURE 6.2 5d). jobGate is the rule; gateSql is its mirror in feedRows (scripts/gate-test.ts
 * checks they agree on real jobs). scoreFeatures and candidateScore call jobGate, so the card, the score and the swipe
 * check agree. READING_GATE=0 turns the reading part off on every process (the old SQL track filter returns).
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

/** The reading gate is on unless READING_GATE=0 (the one-env rollback, TDD 4.9). */
export function readingGateOn() {
  return process.env.READING_GATE !== "0";
}

const current = (job: GateJob) => job.readingCurrent === true;

/** The title's track: Job.track, else classifyTitle ("non_tech" for a title it calls non-tech). The score and the card use this. */
export function titleTrack(job: Pick<GateJob, "title" | "track">): string | null {
  if (job.track) return job.track;
  const title = classifyTitle(job.title);
  return title.function === "non_tech" ? "non_tech" : title.track;
}

/**
 * The job's family: the reading's roleFamily when the reading is current and names one, else the title's track.
 * Decides non-tech; the field needs the title's track and this family both in the tracks.
 */
export function trackOf(job: GateJob): string | null {
  if (current(job) && job.roleFamily) return job.roleFamily;
  return titleTrack(job);
}

export type GateRule = "field" | "non_tech" | "gig" | "task" | "paid_task" | `avoid_${Avoid}`;
export type GateResult = { pass: true } | { pass: false; rule: GateRule };

/**
 * Whether a job may be shown or applied to. `tracks` is the effective list the feed used (the Track filter's picks,
 * else feedTracks); null skips the field part. The field part is title AND reading (P2, owner, 19 Nov): the title's
 * track must be in `tracks` and, when the reading is current and names a family, so must that family; the reading can
 * take a job out, never put one in. `field: false` (the swipe check, which cannot know the Track filter the card was
 * shown under) enforces non-tech, gig, task, paid task and avoid only. Mock jobs always pass. Kind and flags count only
 * from a current reading.
 */
export function jobGate(job: GateJob, who: { tracks: string[] | null; avoid?: readonly string[] | null }, options: { field: boolean }): GateResult {
  if (job.source === "mock") return { pass: true };
  if (trackOf(job) === "non_tech") return { pass: false, rule: "non_tech" };
  if (options.field && who.tracks) {
    const title = titleTrack(job);
    if (!title || !who.tracks.includes(title)) return { pass: false, rule: "field" };
    if (current(job) && job.roleFamily && !who.tracks.includes(job.roleFamily)) return { pass: false, rule: "field" };
  }
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

/** Why a job failed the gate, in the card's and the swipe check's words. */
export function gateReason(rule: GateRule, track: string | null, label: (track: string) => string) {
  if (rule === "field") return track && track !== "non_tech" ? `Not your field (${label(track)})` : "Not a tech role";
  if (rule === "non_tech") return "Not a tech role";
  if (rule === "gig" || rule === "task" || rule === "paid_task") return "Not a job: paid gig or task";
  if (rule === "avoid_contract") return "A contract role";
  if (rule === "avoid_intern") return "An internship";
  return "Commission only";
}

/**
 * jobGate in SQL, on the alias `j` of "Job" (feedRows): the same rule over the stored columns. A job with no stored
 * track and no stored function (never classified) has no title track here; ingest classifies every job, and
 * gate-test compares the two on real jobs. Never NULL: coalesce makes an unknown a fail.
 */
export function gateSql(who: { tracks: string[] | null; avoid?: readonly string[] | null }) {
  const tracks = who.tracks;
  const avoid = [...(who.avoid ?? [])];
  return Prisma.sql`coalesce(j.source = 'mock' OR (
    coalesce(CASE WHEN j."readingCurrent" THEN j."roleFamily" END, j.track, CASE WHEN j.function = 'non_tech' THEN 'non_tech' END) IS DISTINCT FROM 'non_tech'
    AND (${tracks}::text[] IS NULL OR (
      j.track = ANY(${tracks}::text[])
      AND (NOT j."readingCurrent" OR j."roleFamily" IS NULL OR j."roleFamily" = ANY(${tracks}::text[]))))
    AND (NOT j."readingCurrent" OR (
      coalesce(j.kind, '') NOT IN ('gig', 'task')
      AND NOT ('paid_task' = ANY(j.flags))
      AND NOT ('contract' = ANY(${avoid}::text[]) AND coalesce(j.kind, '') = 'contract')
      AND NOT ('intern' = ANY(${avoid}::text[]) AND coalesce(j.kind, '') = 'intern')
      AND NOT ('commission_only' = ANY(${avoid}::text[]) AND 'commission_only' = ANY(j.flags))))
  ), false)`;
}
