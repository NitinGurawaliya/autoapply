import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
// Leaf files, not the jobs index: match.ts reads the learned lines, so the index would import itself back.
import { TRACK_LABELS, TRACKS, tracksOf, type Track } from "@/modules/jobs/functions";
import { trackOf } from "@/modules/jobs/gate";
import { buildBrief, learnedSchema, type LearnedLine } from "./brief";

/**
 * Learning from swipes (Phase P, P8; docs/relevance/TDD.md 4.1 item 9; since 20 Nov with no question to the user, owner:
 * "we dont want to ask for each skip why, the agent should self learn"). Every swipe counts, a skip and an apply alike;
 * after each one the agent looks at the user's last 30 days, per field (the job's family at the swipe, `Swipe.family`, so
 * a later re-reading never moves an old skip) and per kind (contract, internship):
 *  - skipped LEARN_AFTER_OTHER times in a family outside the user's fields, LEARN_AFTER_OWN times in one of their own
 *    (they chose it, so more evidence), or LEARN_AFTER_KIND times in a kind, and applied to none: a learned line lowers
 *    that family's or kind's rank by LEARNED_RANK, never the score ("You skip most Data engineering roles");
 *  - an apply to a family or kind with an active line lifts it by itself (the user's later behaviour wins).
 * Nothing is asked and nothing is hidden: a line only reorders, it shows on /account with × to take it back, and the
 * "Never show me" chips stay the user's own hard filter. Lines live in CandidateBrief.learned, outside fitHash; a
 * removal (× or the automatic lift) restarts that family's count, so the next skip never undoes it.
 */

/** The window the swipes are read in, and the evidence a learned line needs. */
export const WINDOW_DAYS = 30;
export const LEARN_AFTER_OTHER = 5;
export const LEARN_AFTER_OWN = 8;
export const LEARN_AFTER_KIND = 3;
/** What a learned line takes off a job's rank (never its score). */
export const LEARNED_RANK = 10;

/** The job kinds a line may act on, as the "Never show me" chips (P4) name them. */
const KINDS = [
  { kind: "contract", noun: "contract roles" },
  { kind: "intern", noun: "internships" },
] as const;
export const KIND_PREFIX = "kind:";

export function familyLabel(family: string) {
  return TRACK_LABELS[family as Track] ?? family;
}

function noteFor(family: string) {
  if (family.startsWith(KIND_PREFIX)) return `You skip most ${KINDS.find((item) => `${KIND_PREFIX}${item.kind}` === family)?.noun ?? family}`;
  return `You skip most ${familyLabel(family)} roles`;
}

function parseLearned(value: unknown): LearnedLine[] {
  const parsed = learnedSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

const isRank = (line: LearnedLine) => (line.kind ?? "rank") === "rank";

/** The learned lines that act on rank: family or `kind:…` → the card's note. Pure; match.ts calls it on the stored JSON. */
export function activeLearned(value: unknown): Map<string, string> {
  return new Map(parseLearned(value).filter((line) => isRank(line) && !line.dismissedAt).map((line) => [line.family, line.note]));
}

/** The stored row's learned lines, under a row lock (one writer at a time: two quick swipes never lose a line). */
async function lockLearned(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<Array<{ learned: unknown }>>`SELECT "learned" FROM "CandidateBrief" WHERE "userId" = ${userId} FOR UPDATE`;
  return rows.length > 0 ? parseLearned(rows[0].learned) : null;
}

async function writeLearned(tx: Prisma.TransactionClient, userId: string, learned: LearnedLine[]) {
  // Only the learned column: the brief, fitHash and the fit lease are never touched, so nothing re-judges.
  await tx.$executeRaw`UPDATE "CandidateBrief" SET "learned" = ${JSON.stringify(learned)}::jsonb WHERE "userId" = ${userId}`;
}

/** One swipe, as the decision needs it: its direction, the job's family and kind, and when. */
export type SwipeRow = { direction: string; family: string | null; kind: string | null; createdAt: Date };

/** The last dismissal of each family (a deleted or lifted line); counting starts after it. */
function dismissals(learned: LearnedLine[]) {
  const last = new Map<string, number>();
  for (const line of learned) {
    if (!line.dismissedAt) continue;
    const at = Date.parse(line.dismissedAt);
    if (at > (last.get(line.family) ?? 0)) last.set(line.family, at);
  }
  return last;
}

/**
 * What the user's recent swipes say, as a pure decision: the learned lines to add and the ids of active lines to lift.
 * `now` and the rows are given so learning-test can check it offline.
 */
export function decide(input: { rows: SwipeRow[]; learned: LearnedLine[]; tracks: string[]; avoid: string[]; now: number }) {
  const since = dismissals(input.learned);
  const windowStart = input.now - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const tally = (family: string, match: (row: SwipeRow) => boolean, from = 0) => {
    const rows = input.rows.filter((row) => row.createdAt.getTime() > Math.max(windowStart, since.get(family) ?? 0, from) && match(row));
    return { skipped: rows.filter((row) => row.direction === "left").length, applied: rows.filter((row) => row.direction === "right").length };
  };

  const active = new Map(input.learned.filter((line) => isRank(line) && !line.dismissedAt).map((line) => [line.family, line]));
  const lines: LearnedLine[] = [];
  const lift: string[] = [];
  const consider = (family: string, match: (row: SwipeRow) => boolean, need: number) => {
    const line = active.get(family);
    if (line) {
      // An apply after the line was made: the user's later behaviour wins, the line goes and the count starts again.
      if (tally(family, match, Date.parse(line.at)).applied > 0) lift.push(line.id);
      return;
    }
    const { skipped, applied } = tally(family, match);
    if (skipped >= need && applied === 0) lines.push({ id: randomUUID(), kind: "rank", family, note: noteFor(family), at: new Date(input.now).toISOString(), dismissedAt: null });
  };

  const families = new Set(input.rows.map((row) => row.family).filter((family): family is string => !!family && (TRACKS as readonly string[]).includes(family)));
  for (const family of [...families, ...active.keys()].filter((family, i, all) => !family.startsWith(KIND_PREFIX) && all.indexOf(family) === i)) {
    consider(family, (row) => row.family === family, input.tracks.includes(family) ? LEARN_AFTER_OWN : LEARN_AFTER_OTHER);
  }
  for (const { kind } of KINDS) {
    if (input.avoid.includes(kind)) continue;
    consider(`${KIND_PREFIX}${kind}`, (row) => row.kind === kind, LEARN_AFTER_KIND);
  }
  return { lines, lift };
}

type RawSwipe = {
  direction: string;
  family: string | null;
  createdAt: Date;
  source: string | null;
  title: string | null;
  track: string | null;
  roleFamily: string | null;
  readingCurrent: boolean | null;
  kind: string | null;
};

/** The user's last WINDOW_DAYS of swipes with their job's family (the swipe's own, else the job's now) and kind. */
async function swipesOf(userId: string): Promise<SwipeRow[]> {
  const rows = await db.$queryRaw<RawSwipe[]>`
    SELECT s."direction", s."family", s."createdAt", j."source", j."title", j."track", j."roleFamily", j."readingCurrent", j."kind"
    FROM "Swipe" s LEFT JOIN "Job" j ON j."id" = s."jobId"
    WHERE s."userId" = ${userId} AND s."createdAt" > now() - make_interval(days => ${WINDOW_DAYS}::int)`;
  return rows.map((row) => ({
    direction: row.direction,
    family: row.family ?? (row.source && row.title ? trackOf({ source: row.source, title: row.title, track: row.track, roleFamily: row.roleFamily, readingCurrent: row.readingCurrent }) : null),
    kind: row.readingCurrent ? row.kind : null,
    createdAt: row.createdAt,
  }));
}

/**
 * After a swipe: what the swipes now say. Adds the new learned lines and lifts the ones an apply has contradicted.
 * `changed` is true when a line was added or lifted (the caller forgets the cached feed so the rank moves).
 */
export async function learnFromSwipes(userId: string): Promise<{ changed: boolean }> {
  const [profile, brief] = await Promise.all([
    db.profile.findUnique({ where: { userId }, select: { tracks: true, currentTitle: true, skills: true, experience: true, avoid: true } }),
    db.candidateBrief.findUnique({ where: { userId }, select: { learned: true } }),
  ]);
  if (!profile) return { changed: false };
  // The learned lines live on the brief's row; a user who never had one gets it built now.
  if (!brief) await buildBrief(userId);
  const tracks = tracksOf(profile);
  const rows = await swipesOf(userId);
  // Nothing to change is the usual case: decided without a lock, and only a change takes the row lock and decides again.
  const quick = decide({ rows, learned: parseLearned(brief?.learned), tracks, avoid: profile.avoid, now: Date.now() });
  if (brief && quick.lines.length === 0 && quick.lift.length === 0) return { changed: false };
  return db.$transaction(async (tx) => {
    const learned = await lockLearned(tx, userId);
    if (!learned) return { changed: false };
    const now = Date.now();
    const { lines, lift } = decide({ rows, learned, tracks, avoid: profile.avoid, now });
    if (lines.length === 0 && lift.length === 0) return { changed: false };
    const lifted = new Set(lift);
    const next = learned.map((line) => (lifted.has(line.id) ? { ...line, dismissedAt: new Date(now).toISOString() } : line));
    await writeLearned(tx, userId, [...next, ...lines]);
    return { changed: true };
  });
}

/** Deletes a learned line (× on /account): it keeps its dismissal date, so the family's count starts again from now. */
export async function deleteLearned(userId: string, id: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const learned = await lockLearned(tx, userId);
    const line = learned?.find((item) => item.id === id && isRank(item) && !item.dismissedAt);
    if (!learned || !line) return false;
    line.dismissedAt = new Date().toISOString();
    await writeLearned(tx, userId, learned);
    return true;
  });
}
