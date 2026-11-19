import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { daysAgoLabel } from "@/lib/days";
import { cachedFeed, rememberFeed } from "@/lib/feed-cache";
import { companyKey, feedHistory, loadRules, roleKey } from "@/modules/governance";
// The brief file itself, not the profile index (which pulls in resume parsing).
import { briefOf } from "@/modules/profile/brief";
import { fitJobs, fitOn, type FitStore, type FitWho } from "./fit";
import { ADJACENT, classifyTitle, SENIORITIES, TRACK_LABELS, TRACKS, trackFit, type Track, tracksOf } from "./functions";
import { gateReason, gateSql, type GateJob, jobGate, readingGateOn } from "./gate";
import { companyResultsById, judge } from "./results";
import { APPLY_BOARDS } from "./pool";
import { formatSalary } from "./salary";
import { judgeJobs, type Judgement, type JudgementStore, profileVector } from "./semantic";
import { candidateSkills, compareSkills, jobSkills } from "./skills";
import { requiredYears } from "./tagging";

export { daysAgoLabel };

export { APPLY_BOARDS };
const BOARDS = APPLY_BOARDS;
// Where a job is, for the feed's Location filter (T80): IN = in India and REMOTE = remote and open to India (Job.eligibility,
// tagging.ts); US and OTHER = jobs abroad, shown only when the user picks them.
const COUNTRIES = ["IN", "REMOTE", "US", "OTHER"] as const;
export const DEFAULT_PLACES = ["IN", "REMOTE"];
export const DEFAULT_FEED_DAYS = 60;
export const STAGES = ["startup", "midsize", "mnc"] as const;
export type Tier = "strong" | "good" | "stretch";

const skillsSchema = z.array(z.string());

export type FeedFilters = {
  boards: string[];
  countries: string[];
  expMax: number | null;
  days: number;
  /** "fresher": up to 1 year asked; "early": up to 2. A job that states neither level nor years stays in (the model ranks
   * it); a mid or senior title, or more years than the band, leaves. */
  level: "any" | "fresher" | "early";
  /** Company types to show; empty = all. */
  stages: string[];
  /** Tracks to show, among the user's own and the adjacent ones; empty = all of them. */
  tracks: string[];
};

export type FeedJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  country: string;
  applyUrl: string;
  daysAgo: number;
  score: number;
  tier: Tier | null;
  reason: string;
  remoteType: string;
  requiredYears: number | null;
  skillHits: string[];
  stage: string | null;
  /** The company's logo (Company.logoUrl), when we have one. */
  logoUrl: string | null;
  track: string | null;
  /** First seen by ingest in the last 24 hours and posted in the last 7 days: the card says "New". */
  isNew: boolean;
  /** What past applications to this company taught us, when it is worth saying. */
  hint: string | null;
  /** How the score was reached (Phase M4): its parts and any cap or floor; parts plus adjustments equal `score`. */
  breakdown: Breakdown;
  /** The job's tech skills against the candidate's (skills.ts compareSkills). `split`: missing lists required ones only. */
  skills: { have: string[]; missing: string[]; split: boolean; total: number; mentioned: string[] };
  /** The job's stated level (Job.seniority). */
  seniority: string | null;
  /** The candidate's own years (Profile.yearsExperience), for "2+ yrs · you have 1". */
  yourYears: number | null;
  /** Pay as the board published it, formatted ("₹15L – ₹30L"); null when the board gives none. */
  salary: string | null;
  /** The requirement line the fit verdict rests on (fit.ts, RELEVANCE_FIT, P6), shown on the job page; null otherwise. */
  quote: string | null;
};

/** One part of the match score, out of its maximum, with what it measured (Phase M4). */
export type ScorePart = { key: "work" | "skills" | "experience" | "location"; label: string; points: number; max: number; note: string };
/** A cap or floor applied after the parts were added: `effect` is the points it moved the score by. */
export type ScoreAdjustment = { key: "years_cap" | "unstated_cap" | "verdict_floor" | "ceiling"; label: string; effect: number };
export type Breakdown = { parts: ScorePart[]; adjustments: ScoreAdjustment[] };
const NO_BREAKDOWN: Breakdown = { parts: [], adjustments: [] };

const COUNTRY_ALIASES: Record<string, (typeof COUNTRIES)[number]> = {
  in: "IN",
  india: "IN",
  us: "US",
  usa: "US",
  remote: "REMOTE",
  other: "OTHER",
};

function listParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.flatMap((item) => item.split(","));
  if (!value) return [];
  return value.split(",");
}

export function parseFeedFilters(input: {
  boards?: string | string[];
  country?: string | string[];
  expMax?: string | string[];
  days?: string | string[];
  level?: string | string[];
  stage?: string | string[];
  track?: string | string[];
}): FeedFilters {
  const boards = listParam(input.boards)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => (BOARDS as readonly string[]).includes(item));
  const countries = listParam(input.country)
    .map((item) => COUNTRY_ALIASES[item.trim().toLowerCase()])
    .filter((item): item is (typeof COUNTRIES)[number] => Boolean(item));
  const expRaw = listParam(input.expMax)[0];
  const daysRaw = listParam(input.days)[0];
  const expMax = expRaw != null && expRaw !== "" && Number.isFinite(Number(expRaw)) ? Number(expRaw) : null;
  // Every job ingest keeps (posted in the last 60 days and still listed: schedule.ts DEFAULT_INGEST_DAYS) unless the
  // user narrows it; a 30-day default hid open fresher roles posted 31-60 days ago (11 Oct).
  const daysNum = daysRaw != null && Number.isFinite(Number(daysRaw)) ? Number(daysRaw) : DEFAULT_FEED_DAYS;
  const stages = listParam(input.stage).map((item) => item.trim().toLowerCase()).filter((item) => (STAGES as readonly string[]).includes(item));
  const tracks = listParam(input.track).map((item) => item.trim().toLowerCase()).filter((item) => (TRACKS as readonly string[]).includes(item));
  return {
    boards: boards.length > 0 ? boards : [...BOARDS],
    // In India and remote-from-India unless the user picks places abroad too.
    countries: countries.length > 0 ? COUNTRIES.filter((country) => countries.includes(country)) : [...DEFAULT_PLACES],
    expMax,
    days: Math.min(Math.max(daysNum, 1), 365),
    level: (["fresher", "early"] as const).find((level) => level === listParam(input.level)[0]?.trim().toLowerCase()) ?? "any",
    stages: [...new Set(stages)],
    tracks: [...new Set(tracks)],
  };
}

function tokens(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((token) => token.length > 1);
}

const ROLE_ALIASES: Record<string, string> = { developer: "engineer", dev: "engineer", programmer: "engineer", swe: "engineer" };

function titleTokens(value: string) {
  return tokens(value).map((token) => ROLE_ALIASES[token] ?? token);
}

function mentions(text: string, needle: string) {
  const escaped = needle.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return new RegExp(`(^|[^a-z0-9+#])${escaped}($|[^a-z0-9+#])`).test(text);
}

function clamp(score: number) {
  return Math.max(0, Math.min(100, score));
}

type Candidate = {
  currentTitle: string | null;
  skills: string[];
  yearsExperience: number | null;
  preferredLocations: string[];
  /** The candidate's tech tracks (functions.ts). With tracks, a job outside them is out; without, title words count. */
  tracks?: string[];
  /** Every vocabulary skill the candidate shows, in their skills or resume (skills.ts candidateSkills); missing = from `skills`. */
  shows?: Set<string>;
};

/** The job's vocabulary skills (Job.skills) and the required ones when the model's labels belong to this posting. */
type JobSkillsInput = { names: string[]; required: string[] | null };

// Phase N (owner, 18 Nov): the work and the job's skills decide the score. Experience is 10 and location none, since
// both are gates already (bandMiss, the place filter): at 20 + 10 they gave every card 24-30 points for passing them.
const SKILLS_MAX = 40;
// A posting that names no vocabulary skill earns no skills points (owner, 19 Nov). It was a middle 15, and with the 5
// for unstated years those 20 points carried mechanical, lab and art roles from the new boards over the minimum of 40.
const NO_TECH_POINTS = 0;
const EXPERIENCE_MAX = 10;
const MIN_NAMED = 5;
const MIN_REQUIRED = 3;

/**
 * Skills out of 40: with the model's labels, 30 for the share of required skills the candidate shows plus 10 for the
 * share of everything named; without, 40 for the share of everything named. `floorOk`: the candidate shows at least
 * half the needed skills (required, else all named) and at least two of them, which the verdict floor needs.
 */
function skillsPart(input: JobSkillsInput | undefined, shows: Set<string>): { points: number; floorOk: boolean; note: string; matched: number } {
  const names = input?.names ?? [];
  if (names.length === 0) return { points: NO_TECH_POINTS, floorOk: false, note: "The posting names no tech skills we know", matched: 0 };
  const required = input?.required?.filter((skill) => names.includes(skill)) ?? [];
  const compared = compareSkills(names, required.length > 0 ? required : null, shows);
  // A posting that names one or two skills says little: the shares count at least 5 named and 3 required, so "Python,
  // and you have it" is not full marks (an "AI Research Contributor" naming only Python scored 40 of 40, 18 Nov).
  const allShare = compared.have.length / Math.max(names.length, MIN_NAMED);
  if (required.length === 0) {
    return { points: Math.round(SKILLS_MAX * allShare), floorOk: compared.have.length >= 2 && compared.have.length * 2 >= names.length, note: `You have ${compared.have.length} of the ${names.length} skills it names`, matched: compared.have.length };
  }
  const requiredHave = required.length - compared.missing.length;
  const requiredShare = requiredHave / Math.max(required.length, MIN_REQUIRED);
  const optional = names.length - required.length;
  const note = `You have ${requiredHave} of its ${required.length} required ${required.length === 1 ? "skill" : "skills"}${optional > 0 ? ` and ${compared.have.length - requiredHave} of ${optional} nice to have` : ""}`;
  return { points: Math.round(30 * requiredShare + 10 * allShare), floorOk: requiredHave >= 2 && requiredHave * 2 >= required.length, note, matched: compared.have.length };
}

/** Experience out of 10: the years fit 10, one more than the candidate has 7, two more 3, not stated 5. */
function experiencePoints(asks: number | null, gap: number) {
  if (asks == null) return 5;
  return gap <= 0 ? EXPERIENCE_MAX : gap === 1 ? 7 : gap === 2 ? 3 : 0;
}

/** Whether the job is remote or in a place the candidate asked for (no preference = any place). */
function placeFits(job: { country: string; remoteType: string }, prefs: string[]) {
  if (prefs.length === 0 || job.country === "REMOTE" || job.remoteType === "remote") return true;
  return (prefs.includes("India") && job.country === "IN") || (prefs.includes("US") && job.country === "US") || (prefs.includes("Other") && job.country === "OTHER");
}

// Closeness by meaning (cosine similarity of the resume and the job, semantic.ts). Measured 10 Oct on the real
// profiles: their own kind of role 0.45-0.68, other work 0.30-0.55 (product, program and people roles come close),
// so closeness ranks and shortlists, and the model's verdict on the shortlist decides the field. Below FLOOR a job is
// left out; without a verdict (the model failed) it needs UNJUDGED_FLOOR.
export const SIMILARITY_FLOOR = 0.35;
const UNJUDGED_FLOOR = 0.45;
const SIMILARITY_LOW = 0.35;
const SIMILARITY_HIGH = 0.6;
// The closest jobs the model judges per feed (cached per resume and posting, so mostly once), more when the deck is
// short, up to MAX_SHORTLIST.
export const SHORTLIST = 150;
export const MAX_SHORTLIST = 450;
export const FEED_SIZE = 40;
// The model's verdict, the biggest part of the work (Phase N: 35 / 25 / 10 of the work's 50; unjudged 14).
const FIT_POINTS = { strong: 35, good: 25, stretch: 10 } as const;
const UNJUDGED_POINTS = 14;
const CLOSENESS_MAX = 15;
const WORK_MAX = 50;
// The lowest score of each tier (tierOf): a verdict the level and place agree with shows at least that tier.
const VERDICT_FLOOR = { strong: 75, good: 60, stretch: 0 } as const;

// Strict matching (owner, 9 Nov: "only exact matches"). Hard filters decide which jobs a user may see; closeness by
// meaning and the model's verdict only rank the jobs that pass. Before this, a seniority gap only capped the score
// (2 years over → 50, above min_match_score 40) and the tracks were no gate once the resume had a vector, so SDE II
// roles showed to 0-1 year users and data, DevOps and non-tech roles filled their decks (scripts/feed-audit.ts).

/** The most years a job may ask of a candidate: their whole years, and 1 for a fresher (a "0-1 years" role). Unknown
 * years count as a fresher: the feed never guesses a candidate more senior than they said. */
export function yearsBand(years: number | null | undefined) {
  return Math.max(1, Math.floor(years ?? 0));
}

// The years a stated level needs (functions.ts seniorityOf; tagging.ts titleYears reads the same titles as II ≈ 2,
// Senior ≈ 5, lead or manager ≈ 6). Interns are not shown from 3 years, entry roles not from 5.
const LEVEL_MIN_YEARS: Record<string, number> = { intern: 0, entry: 0, mid: 2, senior: 5, staff: 6, manager: 6 };

/** Whether a job's stated level suits the candidate's years. A job that states no level passes on this count. */
export function levelAllowed(level: string | null | undefined, years: number | null | undefined) {
  if (!level) return true;
  const have = years ?? 0;
  if (level === "intern" && have >= 3) return false;
  if (level === "entry" && have >= 5) return false;
  return (LEVEL_MIN_YEARS[level] ?? 0) <= yearsBand(years);
}

/** The levels a candidate may see, for the SQL gate (feedRows). */
export function levelsFor(years: number | null | undefined) {
  return SENIORITIES.filter((level) => levelAllowed(level, years));
}

// Any developer track can take a plain "Software Engineer" / "SDE" role (track `software`); a data scientist, QA,
// security or DevOps candidate cannot.
const GENERIC_SOFTWARE_OK: readonly string[] = ["frontend", "backend", "fullstack", "mobile", "ml_ai", "software"];

/** The tracks a candidate's feed shows by default: their own, plus plain software roles for developers, plus the
 * adjacent tracks when they turned on "Also show nearby fields" (Profile.showNearby, P4); otherwise adjacent tracks
 * show only when picked in the Track filter. Null = no gate (a profile without tracks). */
export function feedTracks(tracks: string[], nearby = false): string[] | null {
  if (tracks.length === 0) return null;
  const adjacent = nearby ? tracks.flatMap((track) => ADJACENT[track as Track] ?? []) : [];
  return [...new Set([...tracks, ...(tracks.some((track) => GENERIC_SOFTWARE_OK.includes(track)) ? ["software"] : []), ...adjacent])];
}

/** Why a job fails the years or level gate for this candidate, or null when it passes. */
export function bandMiss(job: { requiredYears: number | null; seniority: string | null }, years: number | null | undefined) {
  const band = yearsBand(years);
  if (job.requiredYears != null && job.requiredYears > band) return `They want about ${job.requiredYears}+ years; you have ${years ?? 0}`;
  if (!levelAllowed(job.seniority, years)) return job.seniority === "intern" || job.seniority === "entry" ? "An entry-level role, below your experience" : `A ${job.seniority} role, above your experience`;
  return null;
}

// A job that states neither its years nor its level can't be proven off-band, so it stays, but never as Strong: the
// most it can score is the top of Good.
const UNSTATED_CAP = 74;

/** Strong, good or stretch from the score; null below the minimum. */
export function tierOf(score: number, minScore: number): Tier | null {
  if (score >= 75) return "strong";
  if (score >= 60) return "good";
  return score >= minScore ? "stretch" : null;
}

/** The one gate's inputs for a scorer (gate.ts jobGate): the job's gate columns and who it is for. */
export type ScoreGate = { job: GateJob; tracks: string[] | null; avoid?: readonly string[] | null; field: boolean };

export function scoreJob(
  job: {
    title: string;
    description: string;
    country: string;
    remoteType: string;
    experienceMin: number | null;
    /** The stored track (Job.track, written at ingest from classifyTitle); null or missing = classified from the title. */
    track?: string | null;
    /** The stored level (Job.seniority); missing = read from the title. */
    seniority?: string | null;
    /** Closeness to the resume by meaning (semantic.ts jobSimilarity); null or missing = match by tracks. */
    similarity?: number | null;
    /** The model's verdict on this job for this resume (semantic.ts judgeJobs). */
    judgement?: Judgement | null;
    /** The stored vocabulary skills (Job.skills) and labels; missing = found in the title and description here. */
    skills?: string[];
    skillsRequired?: string[];
    skillsHash?: string | null;
    contentHash?: string | null;
  },
  candidate: Candidate,
  gate?: ScoreGate,
) {
  const title = job.title.toLowerCase();
  const description = job.description.toLowerCase();
  const skillHits = candidate.skills.filter((skill) => mentions(title, skill) || mentions(description, skill));
  // The same features the feed scores with (listFeed's scoreAll): the stored track and years, each read from the title
  // and text only when not stored. Two scorers fed differently showed a card the swipe then refused, and the reverse
  // (1 Nov verification, finding 3).
  const kind = classifyTitle(job.title);
  return scoreFeatures(
    {
      title: job.title,
      track: job.track ?? kind.track,
      seniority: job.seniority === undefined ? kind.seniority : job.seniority,
      similarity: job.similarity,
      judgement: job.judgement,
      country: job.country,
      remoteType: job.remoteType,
      requiredYears: job.experienceMin ?? requiredYears(job.title, job.description),
      skillHits,
      jobSkills: job.skills ? labelledSkills({ skills: job.skills, skillsRequired: job.skillsRequired ?? [], skillsHash: job.skillsHash ?? null, contentHash: job.contentHash ?? null }) : { names: jobSkills(job.title, job.description), required: null },
    },
    candidate,
    gate,
  );
}

/** The job's skills for the score: the model's labels count only while they belong to this version of the posting. */
function labelledSkills(job: { skills: string[]; skillsRequired: string[]; skillsHash: string | null; contentHash: string | null }): JobSkillsInput {
  const labelled = job.skillsHash != null && job.skillsHash === (job.contentHash ?? "none");
  return { names: job.skills, required: labelled ? job.skillsRequired : null };
}

/**
 * The score from a job's features: which of the candidate's skills it mentions and the years it asks for. scoreJob
 * finds them in the description; the feed finds them in Postgres (feedRows) so descriptions never leave the database.
 */
export function scoreFeatures(
  job: { title: string; track?: string | null; seniority?: string | null; similarity?: number | null; judgement?: Judgement | null; country: string; remoteType: string; requiredYears: number | null; skillHits: string[]; jobSkills?: JobSkillsInput },
  candidate: Candidate,
  gate?: ScoreGate,
) {
  // The one gate (Phase P, gate.ts): the feed passes the effective tracks (the Track filter, else feedTracks), the swipe
  // check `field: false`. A job it removes scores 0 with the rule's reason. The score keeps the title's track (job.track).
  if (gate) {
    const verdict = jobGate(gate.job, { tracks: gate.tracks, avoid: gate.avoid }, { field: gate.field });
    if (!verdict.pass) {
      const reason = gateReason(verdict.rule, job.track ?? null, (track) => TRACK_LABELS[track as Track] ?? track);
      return { score: 0, reason, requiredYears: job.requiredYears, skillHits: job.skillHits, breakdown: NO_BREAKDOWN };
    }
  }
  // The hard gate before any score: years and level (bandMiss). The feed reads only jobs that pass it (feedRows); the
  // swipe check (lifecycle.ts) gets the same 0 for one that doesn't.
  const miss = bandMiss({ requiredYears: job.requiredYears, seniority: job.seniority ?? null }, candidate.yearsExperience);
  if (miss) return { score: 0, reason: miss, requiredYears: job.requiredYears, skillHits: job.skillHits, breakdown: NO_BREAKDOWN };
  const scored = scoreInBand(job, candidate);
  if (job.requiredYears != null || job.seniority || scored.score <= UNSTATED_CAP) return scored;
  const cap: ScoreAdjustment = { key: "unstated_cap", label: `States no years or level: capped at ${UNSTATED_CAP}`, effect: UNSTATED_CAP - scored.score };
  return { ...scored, score: UNSTATED_CAP, breakdown: { ...scored.breakdown, adjustments: [...scored.breakdown.adjustments, cap] } };
}

/** "A fresher role; you have 1 year", "Asks 3+ years; you have 1", "The posting states no years". */
function experienceNote(asks: number | null, have: number) {
  const yours = `you have ${have === 1 ? "1 year" : `${have} years`}`;
  if (asks == null) return "The posting states no years";
  if (asks === 0) return `A fresher role; ${yours}`;
  return `Asks ${asks}+ ${asks === 1 ? "year" : "years"}; ${yours}`;
}

/**
 * The parts, plus the caps that applied after adding them: over 100 (never, since Phase N's parts add to 100), the years
 * ceiling, then the verdict floor. Adjustments are listed only when they moved the score, so parts plus adjustments
 * always equal the score returned.
 */
function finish(parts: ScorePart[], ceiling: number, gap: number, floor = 0, floorLabel = ""): { score: number; breakdown: Breakdown } {
  const adjustments: ScoreAdjustment[] = [];
  const sum = parts.reduce((total, part) => total + part.points, 0);
  let score = clamp(sum);
  if (score < sum) adjustments.push({ key: "ceiling", label: "Capped at 100", effect: score - sum });
  if (ceiling < score) {
    adjustments.push({ key: "years_cap", label: `Asks ${gap} more ${gap === 1 ? "year" : "years"} than you have: capped at ${ceiling}`, effect: ceiling - score });
    score = ceiling;
  }
  if (floor > score) {
    adjustments.push({ key: "verdict_floor", label: floorLabel, effect: floor - score });
    score = floor;
  }
  return { score, breakdown: { parts, adjustments } };
}

function scoreInBand(
  job: { title: string; track?: string | null; similarity?: number | null; judgement?: Judgement | null; country: string; remoteType: string; requiredYears: number | null; skillHits: string[]; jobSkills?: JobSkillsInput },
  candidate: Candidate,
) {
  const title = job.title.toLowerCase();
  if (job.similarity != null) return scoreByMeaning({ ...job, similarity: job.similarity, judgement: job.judgement ?? null }, candidate);
  const tracks = candidate.tracks ?? [];
  // T82: with tracks, the job's track is the gate and most of the title's weight: the same track 30, an adjacent one
  // 18, plus skills named in the title; a job in no track of theirs (or not a tech job) is out.
  const fit = tracks.length > 0 ? trackFit(job.track ?? null, tracks) : null;
  if (fit === "none") {
    return { score: 0, reason: job.track ? `Not your field (${TRACK_LABELS[job.track as Track] ?? job.track})` : "Not a tech role", requiredYears: job.requiredYears, skillHits: job.skillHits, breakdown: NO_BREAKDOWN };
  }
  const skillHits = job.skillHits;
  const jobTitleTokens = new Set(titleTokens(job.title));
  const candidateTitleTokens = [...new Set(titleTokens(candidate.currentTitle ?? ""))];
  const titleOverlap = candidateTitleTokens.filter((token) => jobTitleTokens.has(token));
  const skillsInTitle = candidate.skills.filter((skill) => mentions(title, skill));
  const titleHits = [...(titleOverlap.length > 0 && candidate.currentTitle ? [candidate.currentTitle] : []), ...skillsInTitle];
  const titleRatio = candidateTitleTokens.length === 0 ? 0 : titleOverlap.length / candidateTitleTokens.length;
  const titleScore = fit
    ? Math.min(WORK_MAX, (fit === "same" ? 35 : 20) + 5 * skillsInTitle.length)
    : Math.round(WORK_MAX * Math.min(1, titleRatio + 0.5 * skillsInTitle.length));

  const skills = skillsPart(job.jobSkills, candidate.shows ?? candidateSkills({ skills: candidate.skills }));

  const asks = job.requiredYears;
  const have = candidate.yearsExperience ?? 0;
  const gap = asks == null ? 0 : asks - have;
  const experienceScore = experiencePoints(asks, gap);
  // A big seniority gap can't be offset by a matching title or skills.
  const ceiling = gap >= 4 ? 25 : gap === 3 ? 35 : gap === 2 ? 50 : 100;

  // The reason says what the work is and which of the candidate's skills it uses; years and place are on the card as
  // facts, so the reason does not repeat them (Phase O5) unless the years are well over the candidate's.
  const parts: string[] = [];
  const trackName = job.track ? TRACK_LABELS[job.track as Track] ?? job.track : null;
  if (fit === "same" && trackName) parts.push(`${trackName} work, like yours`);
  else if (fit === "adjacent" && trackName) parts.push(`${trackName} work, close to your field`);
  else if (titleHits.length > 0) parts.push("Similar to roles you've had");
  if (skillHits.length > 0) parts.push(usesSkills(skillHits));
  if (gap >= 2 && asks != null) parts.unshift(`They want about ${asks}+ years; you have ${have}`);

  const workNote =
    fit === "same" && trackName ? `${trackName} work, one of your tracks` : fit === "adjacent" && trackName ? `${trackName} work, next to your tracks` : titleHits.length > 0 ? "Similar to roles you've had" : "Not much like roles you've had";
  const finished = finish(
    [
      { key: "work", label: "The work", points: titleScore, max: WORK_MAX, note: skillsInTitle.length > 0 ? `${workNote}; the title names ${skillsInTitle.slice(0, 3).join(", ")}` : workNote },
      { key: "skills", label: "Skills", points: skills.points, max: SKILLS_MAX, note: skills.note },
      { key: "experience", label: "Experience", points: experienceScore, max: EXPERIENCE_MAX, note: experienceNote(asks, have) },
    ],
    ceiling,
    gap,
  );
  return {
    score: finished.score,
    reason: parts.slice(0, fit ? 3 : 2).join(". ") || "A stretch for your profile",
    requiredYears: asks,
    skillHits,
    breakdown: finished.breakdown,
  };
}

/**
 * The score when the job and the resume both have vectors (semantic.ts): the model's verdict (no = out; strong 30,
 * good 20, stretch 8), closeness by meaning up to 30, the candidate's skills named in the job up to 10, experience 20
 * (a big gap caps the total, as in scoreFeatures) and location 10.
 */
function scoreByMeaning(
  job: { title: string; track?: string | null; similarity: number; judgement: Judgement | null; country: string; remoteType: string; requiredYears: number | null; skillHits: string[]; jobSkills?: JobSkillsInput },
  candidate: Candidate,
) {
  const trackName = job.track ? TRACK_LABELS[job.track as Track] ?? null : null;
  const verdict = job.judgement;
  if (verdict?.fit === "no") return { score: 0, reason: sentence(verdict.why) || "Not your kind of role", requiredYears: job.requiredYears, skillHits: job.skillHits, breakdown: NO_BREAKDOWN };
  if (job.similarity < (verdict ? SIMILARITY_FLOOR : UNJUDGED_FLOOR)) {
    return { score: 0, reason: "Not close to your experience", requiredYears: job.requiredYears, skillHits: job.skillHits, breakdown: NO_BREAKDOWN };
  }
  const closeness = Math.min(1, Math.max(0, (job.similarity - SIMILARITY_LOW) / (SIMILARITY_HIGH - SIMILARITY_LOW)));
  const closenessScore = Math.round(CLOSENESS_MAX * closeness);
  const verdictScore = verdict ? FIT_POINTS[verdict.fit] : UNJUDGED_POINTS;
  const meaningScore = closenessScore + verdictScore;
  const skills = skillsPart(job.jobSkills, candidate.shows ?? candidateSkills({ skills: candidate.skills }));
  // A stretch with none of the job's skills on the resume is not a match (owner, 19 Nov): the model called it only a
  // stretch, and nothing in the posting shows the candidate can do it.
  if (verdict?.fit === "stretch" && skills.matched === 0) {
    return { score: 0, reason: "A stretch, and none of its skills are on your resume", requiredYears: job.requiredYears, skillHits: job.skillHits, breakdown: NO_BREAKDOWN };
  }

  const asks = job.requiredYears;
  const have = candidate.yearsExperience ?? 0;
  const gap = asks == null ? 0 : asks - have;
  const experienceScore = experiencePoints(asks, gap);
  const ceiling = gap >= 4 ? 25 : gap === 3 ? 35 : gap === 2 ? 50 : 100;

  const inPlace = placeFits(job, candidate.preferredLocations);

  const parts: string[] = [];
  const close = closeness >= 0.6 ? "Very close to your experience" : "Close to your experience";
  parts.push(verdict ? sentence(verdict.why) : trackName ? `${close} (${trackName})` : close);
  if (job.skillHits.length > 0) parts.push(usesSkills(job.skillHits));
  if (gap >= 2 && asks != null) parts.unshift(`They want about ${asks}+ years; you have ${have}`);

  // The model's verdict is the floor when nothing else holds the job back (no years over the candidate's, the place
  // fits): closeness by meaning only orders such jobs. A posting padded with the company's story scored 0.39 and showed
  // a good-verdict intern role to a 1-year developer as Stretch (CloudSEK, 19 Oct).
  // Since Phase N the floor also needs half the job's needed skills: a good verdict from the title's track alone lifted
  // QA roles to 60 for a developer who has none of what they ask (owner, 18 Nov).
  const floor = verdict && gap <= 0 && inPlace && skills.floorOk ? VERDICT_FLOOR[verdict.fit] : 0;
  const verdictWords = { strong: "a strong fit", good: "a good fit", stretch: "a stretch" } as const;
  const finished = finish(
    [
      {
        key: "work",
        label: "The work",
        points: meaningScore,
        max: WORK_MAX,
        note: verdict
          ? `Rated ${verdictWords[verdict.fit as keyof typeof verdictWords]} (${verdictScore} of 35); reads close to your resume (${closenessScore} of ${CLOSENESS_MAX})`
          : `Reads close to your resume (${closenessScore} of ${CLOSENESS_MAX}); not rated yet (${verdictScore})`,
      },
      { key: "skills", label: "Skills", points: skills.points, max: SKILLS_MAX, note: skills.note },
      { key: "experience", label: "Experience", points: experienceScore, max: EXPERIENCE_MAX, note: experienceNote(asks, have) },
    ],
    ceiling,
    gap,
    floor,
    verdict ? `Rated ${verdict.fit === "strong" ? "a strong" : "a good"} fit: raised to ${floor}` : "",
  );
  return {
    score: finished.score,
    reason: parts.slice(0, 3).join(". "),
    requiredYears: asks,
    skillHits: job.skillHits,
    breakdown: finished.breakdown,
  };
}

const sentence = (text: string) => text.trim().replace(/[.\s]+$/, "").replace(/^./, (c) => c.toUpperCase());

/** "Uses your Python, SQL and Airflow": the reason reads as the agent talking, not a checklist (24 Oct, owner). */
function usesSkills(hits: string[]) {
  const shown = hits.slice(0, 3);
  return `Uses your ${shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown[0]}`;
}

function daysAgo(postedAt: Date) {
  const elapsed = Date.now() - postedAt.getTime();
  return Math.max(0, Math.floor(elapsed / (24 * 60 * 60 * 1000)));
}

/** Boards we can apply through, best first; when one role is listed on two of them, the best listing is the card. */
const BOARD_RANK: Record<string, number> = { greenhouse: 0, ashby: 1, lever: 2, mock: 3 };

/** Keeps one listing per company, title and place, so one role listed on two boards is one card. */
export function dedupeListings<T extends { roleKey: string; location: string; source: string; daysAgo: number }>(rows: T[]) {
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.roleKey}|${row.location.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    const current = best.get(key);
    const better =
      !current ||
      (BOARD_RANK[row.source] ?? 9) < (BOARD_RANK[current.source] ?? 9) ||
      ((BOARD_RANK[row.source] ?? 9) === (BOARD_RANK[current.source] ?? 9) && row.daysAgo < current.daysAgo);
    if (better) best.set(key, row);
  }
  return rows.filter((row) => best.get(`${row.roleKey}|${row.location.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`) === row);
}

export type FeedRow = {
  id: string;
  title: string;
  /** For the verdict cache (semantic.ts judgeJobs): read here, so the shortlist needs no second query. */
  contentHash: string | null;
  location: string;
  source: string;
  country: string;
  remoteType: string;
  experienceMin: number | null;
  applyUrl: string;
  postedAt: Date;
  companyId: string;
  company: string;
  stage: string | null;
  logoUrl: string | null;
  track: string | null;
  seniority: string | null;
  similarity: number | null;
  firstSeenAt: Date;
  hits: number[];
  skills: string[];
  skillsRequired: string[];
  skillsHash: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  /** The model's reading (Phase P): read for the one gate, which counts it only while readingCurrent. */
  roleFamily: string | null;
  kind: string | null;
  flags: string[];
  readingCurrent: boolean;
};

/** The SQL regex for mentions(): the skill as literal text between two non-word characters (or the text's ends). */
function skillPattern(needle: string) {
  const literal = needle.replace(/[^a-z0-9 ]/g, (c) => (c === "^" || c === "\\" ? `\\${c}` : `[${c}]`));
  return `(^|[^a-z0-9+#])${literal}($|[^a-z0-9+#])`;
}

/**
 * The feed's candidate jobs, read without their descriptions: Postgres finds which of the candidate's skills each job
 * mentions (`hits`, indexes into `skills`), exactly as mentions() would. A one-word skill is a lookup in the GIN index
 * on the job's `terms` (its distinct words, kept by a trigger); a skill with dots, slashes or spaces ("Node.js") is
 * checked with the same regex, only on jobs whose terms hold all its words. With a minimum score above 30, a job with no skill
 * and no title word in common is left out here: experience and location alone (20 + 10) cannot reach it.
 */
export async function feedRows(input: {
  userId: string;
  sources: string[];
  countries: string[];
  /** The most years a job may ask for the Fresher (1) or Early career (2) level; null = any level. */
  levelYears: number | null;
  /** The candidate's hard band (yearsBand, levelsFor): the most years a job may ask, and the levels it may state.
   * Null = no band (the reference feed in feed-sql-test leaves it to scoreJob). */
  band?: { maxYears: number; levels: string[] } | null;
  stages: string[] | null;
  tracks: string[] | null;
  /** The resume's vector (semantic.ts): each job's closeness to it is read, and jobs below the floor are left out. */
  vector: string | null;
  cutoff: Date;
  expMax: number | null;
  skills: string[];
  titleWords: string[];
  prefilter: boolean;
  /** Only the jobs this user swiped left (the "jobs you skipped" view); otherwise only jobs not swiped either way. */
  skippedOnly?: boolean;
  /**
   * The evaluation's stored pool (Phase P, P2): only these jobs, whether or not they are still open, within the cutoff or
   * swiped. Null for the feed.
   */
  onlyIds?: string[] | null;
  /**
   * The one gate (gate.ts gateSql, READING_GATE): replaces the plain track filter with jobGate's field part (title AND
   * reading) and its non-tech, gig, task, paid-task and avoid rules. False for the evaluation and the reference feed.
   */
  readingGate?: boolean;
  /** The profile's "Never show me" values (P4); empty until then. */
  avoid?: readonly string[];
}) {
  const onlyIds = input.onlyIds ?? null;
  // One row per skill: its words (all must be among the job's words, looked up in the GIN index on terms) and, for
  // a skill that is more than one word, the regex that then checks they appear in that exact spelling.
  const indexes: number[] = [];
  const parts: string[] = [];
  const patterns: string[] = [];
  input.skills.forEach((skill, index) => {
    const needle = skill.toLowerCase().trim();
    if (!needle) return;
    indexes.push(index);
    parts.push(needle.split(/[^a-z0-9+#]+/).filter(Boolean).join(" "));
    patterns.push(/^[a-z0-9+#]+$/.test(needle) ? "" : skillPattern(needle));
  });
  return db.$queryRaw<FeedRow[]>`
    WITH skill AS (
      SELECT * FROM unnest(${indexes}::int[], ${parts}::text[], ${patterns}::text[]) AS s(i, parts, pattern)
    ),
    hit AS (
      SELECT j.id, array_agg(s.i) AS hits
      FROM skill s
      JOIN "Job" j ON j.terms @> string_to_array(s.parts, ' ')
      WHERE s.pattern = '' OR lower(j.title || chr(10) || j.description) ~ s.pattern
      GROUP BY j.id
    ),
    candidates AS (
      SELECT j.id, j.title, j."contentHash", j.location, j.source, j.country, j."remoteType", j."experienceMin", j."applyUrl", j."postedAt",
             j."companyId", c.name AS company, c.stage, c."logoUrl", j.track, j.seniority, j."firstSeenAt", coalesce(h.hits, '{}') AS hits,
             j.skills, j."skillsRequired", j."skillsHash", j."salaryMin", j."salaryMax", j."salaryCurrency", j."salaryPeriod",
             j."roleFamily", j.kind, j.flags, j."readingCurrent",
             CASE WHEN ${input.vector}::text IS NULL OR j.embedding IS NULL THEN NULL
                  ELSE (1 - (j.embedding <=> ${input.vector}::halfvec))::float8 END AS similarity
      FROM "Job" j
      JOIN "Company" c ON c.id = j."companyId"
      LEFT JOIN hit h ON h.id = j.id
      WHERE j.source = ANY(${input.sources}::text[])
        AND (j.source = 'mock' OR
             ('IN' = ANY(${input.countries}::text[]) AND j.eligibility = 'india') OR
             ('REMOTE' = ANY(${input.countries}::text[]) AND j.eligibility = 'remote_india') OR
             ('US' = ANY(${input.countries}::text[]) AND j.eligibility NOT IN ('india', 'remote_india') AND j.country = 'US') OR
             ('OTHER' = ANY(${input.countries}::text[]) AND j.eligibility NOT IN ('india', 'remote_india') AND j.country <> 'US'))
        -- A job that states neither a level nor years stays in the Fresher and Early career bands: the model's verdict
        -- on the resume ranks it (19 Oct: the bands showed a fresher 7 jobs against 31 that fit, dropping plain
        -- "Software Engineer" postings). Only a stated mid/senior title or more years than the band leaves.
        AND (${input.levelYears}::int IS NULL OR j.source = 'mock' OR
             ((j.seniority IN ('intern', 'entry') OR j.seniority IS NULL) AND j."experienceMin" IS NOT NULL AND j."experienceMin" <= ${input.levelYears}::int) OR
             ((j.seniority IN ('intern', 'entry') OR j.seniority IS NULL) AND j."experienceMin" IS NULL))
        -- The candidate's band (strict matching, 9 Nov): no more years than they have, no level above them.
        AND (${input.band?.maxYears ?? null}::int IS NULL OR j.source = 'mock' OR j."experienceMin" IS NULL OR j."experienceMin" <= ${input.band?.maxYears ?? null}::int)
        AND (${input.band?.levels ?? null}::text[] IS NULL OR j.source = 'mock' OR j.seniority IS NULL OR j.seniority = ANY(${input.band?.levels ?? null}::text[]))
        AND (${input.stages}::text[] IS NULL OR c.stage = ANY(${input.stages}::text[]))
        AND ${input.readingGate
          ? gateSql({ tracks: input.tracks, avoid: input.avoid })
          : Prisma.sql`(${input.tracks}::text[] IS NULL OR j.source = 'mock' OR j.track = ANY(${input.tracks}::text[]))`}
        AND (${input.vector}::text IS NULL OR j.embedding IS NULL OR 1 - (j.embedding <=> ${input.vector}::halfvec) >= ${SIMILARITY_FLOOR})
        AND (${onlyIds}::text[] IS NULL OR j.id = ANY(${onlyIds}::text[]))
        AND (${onlyIds}::text[] IS NOT NULL OR j."postedAt" >= ${input.cutoff})
        AND (${onlyIds}::text[] IS NOT NULL OR j."closedAt" IS NULL)
        AND (${input.expMax}::int IS NULL OR j."experienceMin" IS NULL OR j."experienceMin" <= ${input.expMax}::int)
        -- A swiped job never comes back to the feed, left or right; the skipped view is the left ones alone.
        AND (${onlyIds}::text[] IS NOT NULL OR CASE WHEN ${input.skippedOnly ?? false}::boolean
                  THEN EXISTS (SELECT 1 FROM "Swipe" s WHERE s."userId" = ${input.userId} AND s."jobId" = j.id AND s.direction = 'left')
                  ELSE NOT EXISTS (SELECT 1 FROM "Swipe" s WHERE s."userId" = ${input.userId} AND s."jobId" = j.id) END)
    )
    SELECT * FROM candidates
    WHERE NOT ${input.prefilter}
       OR source = 'mock'
       OR cardinality(hits) > 0
       OR regexp_split_to_array(lower(title), '[^a-z0-9+#]+') && ${input.titleWords}::text[]
    ORDER BY id`;
}

/** Every word in a job title that titleTokens() would count as one of the candidate's title words (aliases included). */
function titleWordsFor(currentTitle: string | null) {
  const wanted = new Set(titleTokens(currentTitle ?? ""));
  const aliases = Object.entries(ROLE_ALIASES).filter(([, to]) => wanted.has(to)).map(([from]) => from);
  return [...wanted, ...aliases];
}

/**
 * The job's skills against what the candidate shows (Phase M4). The model's required labels count only while they
 * belong to this version of the posting; `mentioned` is the rest the candidate does not show (nice to have, or every
 * one when there are no labels, in which case they are all in `missing` and `mentioned` is empty).
 */
function jobSkillsFor(job: Pick<FeedRow, "skills" | "skillsRequired" | "skillsHash" | "contentHash">, shows: Set<string>) {
  const { required } = labelledSkills(job);
  const compared = compareSkills(job.skills, required, shows);
  const mentioned = job.skills.filter((skill) => !compared.have.includes(skill) && !compared.missing.includes(skill));
  return { ...compared, total: job.skills.length, mentioned };
}

/** "new": jobs the user has not swiped; "skipped": the ones they swiped left, to look at again once the feed runs out. */
export type FeedView = "new" | "skipped";

/** `warm`: built by warm or prescan (P6: the fit path then judges up to MAX_SHORTLIST in the background lane). */
export type FeedBuild = { warm?: boolean };

export async function listFeed(userId: string, filters: FeedFilters, view: FeedView = "new", build: FeedBuild = {}): Promise<FeedJob[]> {
  // A visit within a minute of the last one, with nothing changed since, reuses its result (lib/feed-cache.ts).
  const filtersKey = view === "new" ? JSON.stringify(filters) : `${JSON.stringify(filters)}|skipped`;
  const cached = cachedFeed<FeedJob[]>(userId, filtersKey);
  if (cached) return cached;
  const feed = await scoreFeed(userId, filters, view, undefined, build);
  rememberFeed(userId, filtersKey, feed);
  return feed;
}

/**
 * How the evaluation (Phase P, P2, scripts/relevance-eval.ts) ranks with this same code: within its stored pool
 * (`onlyIds`: closed, old and swiped jobs included, the weekly company and role limits ignored), with a field gate of
 * its own in place of the SQL track filter (`gate`), its own verdict cache (`store`, never JobJudgement) and the whole
 * ranked list instead of the first FEED_SIZE (`limit`). The feed passes none of it.
 */
export type EvalRanking = {
  /** The stored pool; null when building it (the feed's own open, recent, unswiped rows). */
  onlyIds: string[] | null;
  /** Building the pool: hand the rows that pass the hard gates (no field gate) to this and score nothing. */
  rowsOnly?: (rows: FeedRow[]) => void;
  gate?: { keep: (job: FeedRow, tracks: string[] | null) => boolean; trackOf: (job: FeedRow) => string | null };
  store: JudgementStore;
  /** The fit path's dry run (P6): rank with fit verdicts read from and written to this store (never FitJudgement). */
  fit?: FitStore;
  limit?: number;
};

/** The default feed of this user ranked the evaluation's way (EvalRanking). */
export function rankForEval(userId: string, options: EvalRanking): Promise<FeedJob[]> {
  return scoreFeed(userId, parseFeedFilters({}), "new", options);
}

async function scoreFeed(userId: string, filters: FeedFilters, view: FeedView, evaluation?: EvalRanking, build: FeedBuild = {}): Promise<FeedJob[]> {
  // Independent reads run together: every database round trip is ~250 ms from India to the database.
  const [profile, answers] = await Promise.all([
    db.profile.findUnique({ where: { userId } }),
    db.answer.findMany({ where: { userId, key: "preferred_location" }, select: { answer: true } }),
  ]);
  const skills = skillsSchema.safeParse(profile?.skills).success ? skillsSchema.parse(profile?.skills) : [];
  const preferred = (answers[0]?.answer ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item === "India" || item === "US" || item === "Other");

  // Jobs below the governance minimum would be blocked on swipe anyway, so they never reach the deck.
  const minScore = loadRules().min_match_score;
  const cutoff = new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000);
  const sources = profile?.isTest ? [...new Set([...filters.boards, "mock"])] : filters.boards;
  // The tracks are a hard gate, with or without the resume's vector (strict matching, 9 Nov): the user's own tracks and
  // plain software roles for developers (feedTracks), or exactly the tracks they pick in the Track filter. Closeness
  // by meaning and the model's verdict only rank what passes.
  const tracks = profile ? tracksOf(profile) : [];
  // Every vocabulary skill the candidate shows, in their skills list or their resume (Phase M4): a job's skill is
  // "missing" only when it is in neither.
  const shows = profile ? candidateSkills(profile) : new Set<string>();
  const vector = profile ? await profileVector(profile) : null;
  // "Also show nearby fields" (P4) widens the default tracks; the evaluation keeps the old path.
  const shown = filters.tracks.length > 0 ? filters.tracks : feedTracks(tracks, !evaluation && profile?.showNearby === true);
  const years = profile?.yearsExperience ?? null;
  // The one gate (Phase P, P3): in SQL and again in the score, so the card and the swipe check agree. The evaluation
  // keeps the old path and applies its own rule (EvalRanking.gate).
  const gateOn = readingGateOn() && !evaluation;
  const [jobs, history, results] = await Promise.all([
    feedRows({
      userId,
      sources,
      countries: filters.countries,
      levelYears: filters.level === "fresher" ? 1 : filters.level === "early" ? 2 : null,
      stages: filters.stages.length > 0 ? filters.stages : null,
      // The eval's own gate replaces the SQL track filter; it is applied to the rows below.
      tracks: evaluation?.gate ? null : shown,
      band: { maxYears: yearsBand(years), levels: levelsFor(years) },
      vector,
      cutoff,
      expMax: filters.expMax,
      skills,
      titleWords: titleWordsFor(profile?.currentTitle ?? null),
      // Every job in a reachable track can reach the minimum on its track alone, so none is left out early.
      prefilter: minScore > 30 && tracks.length === 0 && !vector,
      skippedOnly: view === "skipped",
      onlyIds: evaluation?.onlyIds ?? null,
      readingGate: gateOn,
      // "Never show me" (P4): contract, intern, commission-only.
      avoid: gateOn ? (profile?.avoid ?? []) : [],
    }).then((rows) => (evaluation?.gate ? rows.filter((row) => row.source === "mock" || evaluation.gate!.keep(row, shown)) : rows)),
    feedHistory(userId, loadRules().max_per_company_per_week),
    companyResultsById().catch(() => new Map<string, never>()),
  ]);

  if (evaluation?.rowsOnly) {
    evaluation.rowsOnly(jobs);
    return [];
  }

  // The closest jobs (by meaning) that the user can still apply to are judged by the model against the resume
  // (semantic.ts, cached); jobs further away are left out. Mock jobs and jobs without a vector are scored by tracks.
  const open = (job: FeedRow) => Boolean(evaluation) || (!history.roles.has(roleKey(companyKey(job.company), job.title)) && !history.companiesAtCap.has(companyKey(job.company)));
  const closest = jobs
    .filter((job) => job.similarity != null && job.source !== "mock" && open(job))
    .sort((a, b) => b.similarity! - a.similarity! || (a.id < b.id ? -1 : 1));
  const judgements = new Map<string, Judgement>();
  // The fit path (P6, RELEVANCE_FIT; the eval's dry run when it passes a fit store): verdicts from the job's reading and
  // the candidate brief, in FitJudgement. Off, the old judge (JobJudgement, trackFloor) runs unchanged.
  const fitWho: FitWho | null = profile && (evaluation ? Boolean(evaluation.fit) : fitOn()) ? { userId, profileId: profile.id, brief: briefOf(profile), shows, years } : null;

  const scoreAll = (kept: Set<string>) => jobs
    .filter((job) => job.similarity == null || kept.has(job.id))
    .map((job) => {
      const hits = new Set(job.hits);
      const match = scoreFeatures(
        // A job stored without a track (a fixture, a row from before tracks) is classified from its title, as scoreJob does.
        { title: job.title, track: evaluation?.gate ? evaluation.gate.trackOf(job) : (job.track ?? classifyTitle(job.title).track), seniority: job.seniority, similarity: job.similarity, judgement: judgements.get(job.id) ?? null, country: job.country, remoteType: job.remoteType, requiredYears: job.experienceMin, skillHits: skills.filter((_, index) => hits.has(index)), jobSkills: labelledSkills(job) },
        {
          currentTitle: profile?.currentTitle ?? null,
          skills,
          yearsExperience: years,
          preferredLocations: preferred,
          // A track the user picked in the filter counts as theirs for the score (the no-vector path's track gate).
          tracks: [...new Set([...tracks, ...filters.tracks])],
          shows,
        },
        gateOn ? { job: { source: job.source, title: job.title, track: job.track, roleFamily: job.roleFamily, kind: job.kind, flags: job.flags, readingCurrent: job.readingCurrent }, tracks: shown, avoid: profile?.avoid ?? [], field: true } : undefined,
      );
      return {
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        source: job.source,
        country: job.country,
        applyUrl: job.applyUrl,
        daysAgo: daysAgo(job.postedAt),
        score: match.score,
        reason: match.reason,
        requiredYears: match.requiredYears,
        skillHits: match.skillHits.slice(0, 4),
        remoteType: job.remoteType,
        stage: job.stage,
        logoUrl: job.logoUrl,
        track: job.track,
        // New to us AND recently posted: a company added today brings old postings, and "New" beside "Posted 52d ago"
        // read as a contradiction (16 Oct QA).
        isNew: Date.now() - job.firstSeenAt.getTime() < 24 * 60 * 60 * 1000 && Date.now() - job.postedAt.getTime() < 7 * 24 * 60 * 60 * 1000,
        roleKey: roleKey(companyKey(job.company), job.title),
        verdict: judge(results.get(job.companyId)),
        mock: job.source === "mock",
        breakdown: match.breakdown,
        // The model's labels count only while they belong to this version of the posting.
        skills: jobSkillsFor(job, shows),
        seniority: job.seniority,
        salary: formatSalary({ min: job.salaryMin, max: job.salaryMax, currency: job.salaryCurrency, period: job.salaryPeriod }),
        quote: judgements.get(job.id)?.quote ?? null,
      };
    })
    .filter((job) => job.mock || job.score >= minScore)
    .filter((job) => Boolean(evaluation) || !history.roles.has(job.roleKey))
    // A company already at its weekly limit: a swipe would be blocked, so its jobs wait until the week is over.
    .filter((job) => Boolean(evaluation) || !history.companiesAtCap.has(companyKey(job.company)))
    .filter((job) => filters.expMax == null || job.requiredYears == null || job.requiredYears <= filters.expMax);

  // The closest SHORTLIST are judged; when that leaves fewer than a deck of cards (the user swiped most of them), the
  // next closest are judged too, up to MAX_SHORTLIST. Verdicts are cached, so each job is judged once per resume.
  let scored: ReturnType<typeof scoreAll> = [];
  for (let limit = SHORTLIST; ; limit += SHORTLIST) {
    const shortlist = closest.slice(0, limit);
    const missing = shortlist.filter((job) => !judgements.has(job.id)).map((job) => job.id);
    if (fitWho && missing.length > 0) {
      // The request path judges the closest SHORTLIST at most (a cold feed stays fast), warm and prescan up to
      // MAX_SHORTLIST; past that only cached verdicts are read. The eval's dry run judges what it ranks.
      const judge = Boolean(evaluation) || limit <= (build.warm ? MAX_SHORTLIST : SHORTLIST);
      const lane = build.warm || evaluation ? "background" : "interactive";
      for (const [id, verdict] of await fitJobs(fitWho, missing, { store: evaluation?.fit, judge, lease: !evaluation, lane })) judgements.set(id, verdict);
    } else if (profile && missing.length > 0) {
      // Title and fingerprint come with the feed rows; judgeJobs reads descriptions only for jobs not judged yet.
      const missingSet = new Set(missing);
      const texts = jobs.filter((job) => missingSet.has(job.id)).map((job) => ({ id: job.id, title: job.title, contentHash: job.contentHash }));
      for (const [id, judgement] of await judgeJobs(profile, texts, evaluation?.store)) judgements.set(id, judgement);
    }
    scored = scoreAll(new Set(shortlist.map((job) => job.id)));
    if (scored.length >= FEED_SIZE || limit >= closest.length || limit >= MAX_SHORTLIST) break;
  }

  return dedupeListings(scored)
    .map((job) => ({
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      source: job.source,
      country: job.country,
      applyUrl: job.applyUrl,
      daysAgo: job.daysAgo,
      score: job.score,
      tier: tierOf(job.score, minScore),
      reason: job.reason,
      remoteType: job.remoteType,
      requiredYears: job.requiredYears,
      skillHits: job.skillHits,
      stage: job.stage,
      logoUrl: job.logoUrl,
      track: job.track,
      isNew: job.isNew,
      hint: job.verdict.hint,
      breakdown: job.breakdown,
      skills: job.skills,
      seniority: job.seniority,
      yourYears: years,
      salary: job.salary,
      quote: job.quote,
      // Ranking only: the number the user sees stays the honest match score.
      rank: job.score + job.verdict.nudge,
    }))
    // Rows arrive ordered by id, so equal-ranked cards (and duplicate listings) always come out the same way.
    .sort((a, b) => b.rank - a.rank || b.score - a.score || a.daysAgo - b.daysAgo)
    .map(({ rank, ...job }) => {
      void rank;
      return job;
    })
    .slice(0, evaluation?.limit ?? FEED_SIZE);
}
