import { db } from "@/lib/db";
import { tracksOf } from "./functions";
import { jobGate, trackOf, type GateJob } from "./gate";
import { type FeedJob, type FeedRow, rankForEval } from "./match";
import type { Fit, JudgementStore } from "./semantic";

/**
 * The relevance evaluation (Phase P, P2, docs/relevance/TDD.md 7.1): which profiles it covers, the brief the labeller
 * sees, the verdict store it judges into, and the three field rules it compares, each ranked by the feed's own code
 * (match.ts rankForEval) within the profile's stored pool. Used by scripts/label-candidates.ts and relevance-eval.ts;
 * the feed never imports it.
 */

export const ROUND = 1;
export const MIN_SWIPES = 20;
export const RULES = ["old", "reading", "title_or", "title_and", "title_nontech"] as const;
export type Rule = (typeof RULES)[number];
export const RULE_LABELS: Record<Rule, string> = {
  old: "old matcher (title track)",
  reading: "reading decides",
  title_or: "title OR reading",
  title_and: "title AND reading",
  title_nontech: "title; reading cuts non-tech",
};

export type EvalProfile = { profileId: string; userId: string; swipes: number; owner: boolean };

/** Real profiles (not test ones) whose user has at least MIN_SWIPES swipes; `ownerUserId` is marked to be reported apart. */
export async function evalProfiles(ownerUserId?: string | null): Promise<EvalProfile[]> {
  const rows = await db.$queryRaw<Array<{ profileId: string; userId: string; swipes: number }>>`
    SELECT p.id AS "profileId", p."userId", count(s.id)::int AS swipes
    FROM "Profile" p JOIN "Swipe" s ON s."userId" = p."userId"
    WHERE NOT p."isTest"
    GROUP BY p.id, p."userId"
    HAVING count(s.id) >= ${MIN_SWIPES}
    ORDER BY swipes DESC`;
  return rows.map((row) => ({ ...row, owner: row.userId === ownerUserId }));
}

/** The labeller's view of a profile (owner, 19 Nov: tracks, years, title, top skills; never contact data or resume text). */
export async function briefOf(profileId: string) {
  const profile = await db.profile.findUniqueOrThrow({ where: { id: profileId }, select: { currentTitle: true, yearsExperience: true, skills: true, experience: true, tracks: true } });
  const skills = Array.isArray(profile.skills) ? profile.skills.filter((skill): skill is string => typeof skill === "string") : [];
  return { tracks: tracksOf(profile), years: profile.yearsExperience, title: profile.currentTitle, skills: skills.slice(0, 12) };
}

/**
 * Verdicts for the eval's old path: its own EvalJudgement rows first, then the feed's JobJudgement cache (read only, a
 * verdict valid there is the same verdict), and new ones written to EvalJudgement alone.
 */
export const evalStore: JudgementStore = {
  async read(profileId, jobIds) {
    const own = await db.evalJudgement.findMany({ where: { profileId, path: "old", jobId: { in: jobIds } } });
    const have = new Set(own.map((row) => row.jobId));
    const rest = jobIds.filter((id) => !have.has(id));
    const feed = rest.length > 0 ? await db.jobJudgement.findMany({ where: { profileId, jobId: { in: rest } } }) : [];
    return [...own, ...feed];
  },
  async write(profileId, fromHash, rows) {
    await db.$transaction([
      db.evalJudgement.deleteMany({ where: { profileId, path: "old", jobId: { in: rows.map((row) => row.jobId) } } }),
      db.evalJudgement.createMany({ data: rows.map((row) => ({ profileId, path: "old", fromHash, jobId: row.jobId, jobHash: row.jobHash, fit: row.fit as Fit, why: row.why })), skipDuplicates: true }),
    ]);
  },
};

type ReadingCols = Pick<GateJob, "roleFamily" | "kind" | "flags" | "readingCurrent">;

/** The reading columns of these jobs (the feed's rows do not carry them until P3). */
export async function readingsOf(ids: string[]) {
  const rows = await db.job.findMany({ where: { id: { in: ids } }, select: { id: true, roleFamily: true, kind: true, flags: true, readingCurrent: true } });
  return new Map<string, ReadingCols>(rows.map(({ id, ...cols }) => [id, cols]));
}

const asGateJob = (job: FeedRow, reading: ReadingCols | undefined): GateJob => ({ source: job.source, title: job.title, track: job.track, ...reading });

/** The field gate and the family used for the score under each new rule (4.1.4; P2 compares them on labels). */
export function gateFor(rule: Exclude<Rule, "old">, readings: Map<string, ReadingCols>) {
  if (rule === "reading") {
    return {
      keep: (job: FeedRow, tracks: string[] | null) => jobGate(asGateJob(job, readings.get(job.id)), { tracks }, { field: true }).pass,
      trackOf: (job: FeedRow) => trackOf(asGateJob(job, readings.get(job.id))),
    };
  }
  if (rule === "title_nontech") {
    // "title; reading cuts non-tech" (P1 hand check, 19 Nov: the reading's non_tech calls were right 5 of 5 where it
    // contradicted the title, its choice between two tech fields right 7 of 15): the title's track decides the field;
    // the reading only removes a job it reads as non_tech, a gig, a task or a paid task (jobGate without the field part).
    const titleFamily = (job: FeedRow) => trackOf({ source: job.source, title: job.title, track: job.track });
    return {
      keep: (job: FeedRow, tracks: string[] | null) => {
        const family = titleFamily(job);
        if (tracks && (!family || !tracks.includes(family))) return false;
        return jobGate(asGateJob(job, readings.get(job.id)), { tracks }, { field: false }).pass;
      },
      trackOf: titleFamily,
    };
  }
  if (rule === "title_and") {
    // "title AND reading" (added after round 1's labels, 19 Nov: the reading's removals were right, its additions
    // half wrong): the title's track must be one of the tracks, and jobGate on the reading must pass too, so the
    // reading can only take cards away. The score keeps the title's track, as the old matcher does.
    const titleFamily = (job: FeedRow) => trackOf({ source: job.source, title: job.title, track: job.track });
    return {
      keep: (job: FeedRow, tracks: string[] | null) => {
        const family = titleFamily(job);
        if (tracks && (!family || !tracks.includes(family))) return false;
        return jobGate(asGateJob(job, readings.get(job.id)), { tracks }, { field: true }).pass;
      },
      trackOf: titleFamily,
    };
  }
  // "title OR reading": the field passes when either the title's track or a current reading's family is one of the
  // tracks; that family then counts for the score, and kind, flags and non-tech are checked as in jobGate.
  const familyOf = (job: FeedRow, tracks: string[] | null) => {
    const reading = readings.get(job.id);
    const titleFamily = trackOf({ source: job.source, title: job.title, track: job.track });
    const readFamily = reading?.readingCurrent ? (reading.roleFamily ?? null) : null;
    if (!tracks) return readFamily ?? titleFamily;
    return [readFamily, titleFamily].find((family) => family && tracks.includes(family)) ?? null;
  };
  return {
    keep: (job: FeedRow, tracks: string[] | null) => {
      const family = familyOf(job, tracks);
      if (!family) return false;
      const reading = readings.get(job.id);
      const gateJob = { ...asGateJob(job, reading), track: family, roleFamily: reading?.readingCurrent ? family : null };
      return jobGate(gateJob, { tracks }, { field: true }).pass;
    },
    trackOf: (job: FeedRow) => familyOf(job, null),
  };
}

/** The profile's ranked list under one rule, within its stored pool, uncut. */
export async function rankByRule(userId: string, rule: Rule, poolIds: string[], readings: Map<string, ReadingCols>): Promise<FeedJob[]> {
  return rankForEval(userId, { onlyIds: poolIds, store: evalStore, limit: Infinity, gate: rule === "old" ? undefined : gateFor(rule, readings) });
}

/** Today's pool for this user: the feed's open, recent, unswiped rows that pass the hard gates, with no field gate. */
export async function currentPool(userId: string): Promise<string[]> {
  let ids: string[] = [];
  await rankForEval(userId, {
    onlyIds: null,
    store: evalStore,
    gate: { keep: () => true, trackOf: (job) => job.track },
    rowsOnly: (rows) => {
      ids = rows.filter((row) => row.source !== "mock").map((row) => row.id);
    },
  });
  return ids;
}
