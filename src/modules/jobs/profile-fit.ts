import { loadRules } from "@/modules/governance";
import { TRACK_LABELS, type Track } from "./functions";
import { jobGate, trackOf, type GateJob, type GateRule } from "./gate";
import { feedTracks, levelAllowed, yearsReach } from "./match";
import { compareSkills } from "./skills";

// One judgement of a job against a person's profile (Phase X, docs/feed/TDD.md 4.2): whether it matches, its score, and
// the plain reasons it doesn't. Pure, built only from the rules the feed and the swipe check already use, so the card,
// the company page and Apply all say the same thing. A job that doesn't match has no Apply (owner, 27 Nov).

export type FitJob = GateJob & {
  /** Years the posting asks (Job.experienceMin); null when it doesn't say. */
  experienceMin: number | null;
  /** Vocabulary skills the posting names, and the ones the model marked required (null: not split). */
  skills?: string[];
  skillsRequired?: string[] | null;
};

export type FitProfile = {
  tracks: string[];
  showNearby?: boolean | null;
  avoid?: readonly string[] | null;
  yearsExperience: number | null;
  /** Every skill the person shows (skills.ts candidateShows), for the missing-skills reason; leave out to skip it. */
  shows?: Set<string>;
};

export type ProfileFit = {
  /** Passes every hard rule and scores at least `min_match_score`: the only jobs that get Apply. */
  matches: boolean;
  /** A hard rule failed (a kind they never want, outside their fields, level, years): no score can make it match. */
  hard: boolean;
  score: number | null;
  /** Why it doesn't match, most decisive first; empty when it matches. */
  reasons: string[];
};

const GATE_REASON: Partial<Record<GateRule, string>> = {
  non_tech: "Not a tech role",
  gig: "Gig work, not a job",
  task: "Paid per task, not a job",
  paid_task: "Paid per task, not a job",
  avoid_contract: "Contract role: you said never show these",
  avoid_intern: "Internship: you said never show these",
  avoid_commission_only: "Commission only: you said never show these",
};

// levelAllowed refuses a level above the person's years and also one far below (an internship from 3 years).
const LEVEL_LABEL: Record<string, string> = { intern: "Internship", entry: "Entry-level role", mid: "Mid-level role", senior: "Senior role", staff: "Staff role", manager: "Manager role" };

const yearsText = (years: number) => `${years} ${years === 1 ? "year" : "years"}`;

export function profileFit(job: FitJob, profile: FitProfile, judged: { score: number | null; verdictNo?: boolean; verdictReason?: string | null; minScore?: number }): ProfileFit {
  const reasons: string[] = [];
  let hard = false;
  // The kinds no one is shown (non-tech, gig, task) and the ones this person said never: the swipe check's own gate.
  const kinds = jobGate(job, { tracks: null, avoid: profile.avoid ?? [] }, { field: false });
  if (!kinds.pass) {
    hard = true;
    reasons.push(GATE_REASON[kinds.rule] ?? "Not a role you asked for");
  }
  // Their fields: the same list the feed uses (their own, plain software for developers, nearby when they asked).
  const tracks = feedTracks(profile.tracks, Boolean(profile.showNearby));
  if (kinds.pass && tracks) {
    const field = jobGate(job, { tracks, avoid: [] }, { field: true });
    if (!field.pass && field.rule === "field") {
      hard = true;
      const track = trackOf(job);
      const label = track && track in TRACK_LABELS ? TRACK_LABELS[track as Track] : "This field";
      reasons.push(`${label}: not one of your fields`);
    }
  }
  const years = profile.yearsExperience == null ? null : Math.floor(profile.yearsExperience);
  if (!levelAllowed(job.seniority, profile.yearsExperience)) {
    hard = true;
    const label = LEVEL_LABEL[job.seniority ?? ""] ?? "A level above yours";
    reasons.push(years == null ? label : `${label}: you have ${yearsText(years)}`);
  }
  if (job.experienceMin != null && job.experienceMin > yearsReach(profile.yearsExperience)) {
    hard = true;
    reasons.push(years == null ? `Asks ${job.experienceMin}+ years` : `Asks ${job.experienceMin}+ years: you have ${yearsText(years)}`);
  }
  if (profile.shows && job.skills && job.skills.length > 0) {
    const missing = compareSkills(job.skills, job.skillsRequired ?? null, profile.shows).missing.slice(0, 3);
    if (missing.length > 0) reasons.push(`Asks ${missing.join(", ")}`);
  }
  if (judged.verdictNo && judged.verdictReason) reasons.push(judged.verdictReason);
  const min = judged.minScore ?? loadRules().min_match_score;
  const weak = judged.score != null && judged.score < min;
  if (weak && !hard && reasons.length === 0) reasons.push(`Weak match (${judged.score})`);
  // Unknown score (not worked out yet): the rules decide alone; Apply still runs the swipe check's score.
  const matches = !hard && !weak;
  return { matches, hard, score: judged.score, reasons: matches ? [] : reasons };
}
