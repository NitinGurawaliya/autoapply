import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
// Leaf files, not the jobs index: match.ts reads the learned lines, so the index would import itself back.
import { TRACK_LABELS, TRACKS, tracksOf, type Track } from "@/modules/jobs/functions";
import { trackOf } from "@/modules/jobs/gate";
import { buildBrief, learnedSchema, type LearnedLine } from "./brief";

/**
 * Learning from skips (Phase P, P8; docs/relevance/TDD.md 4.1 item 9). After a left swipe the deck asks "Why?" for 4 s;
 * the reason is stored on the swipe with the job's family at that moment (`Swipe.family`, so a later re-reading never
 * moves an old skip). Only `not_my_field` on a left swipe is counted toward a field:
 *  - three in one family within 30 days, after that family's last dismissal: on one of the user's own tracks the feed
 *    asks "Stop showing {family} roles?" (or "Change your fields?" for the last track, which tracksOf would infer back);
 *    on any other family (nearby fields, plain software) a learned line lowers the rank by LEARNED_RANK, never the score.
 *  - three skips with a reason on contract roles (internships) and none applied to: "Hide contract roles?" (owner, 19 Nov).
 * One question at a time, at most one a day. Learned lines and asks live in CandidateBrief.learned, outside fitHash; a
 * dismissal (deleting a line, answering an ask) restarts that family's count, so the next skip never undoes it.
 */

export const SKIP_REASONS = ["not_my_field", "too_senior", "place", "company", "other"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Skips in one family, within the window, that make a learned line or an ask. */
export const LEARN_AFTER = 3;
export const WINDOW_DAYS = 30;
/** What a learned line takes off a job's rank (never its score). */
export const LEARNED_RANK = 10;
const ASK_GAP_MS = 24 * 60 * 60 * 1000;

/** The job kinds the agent may offer to hide, as the "Never show me" chips (P4) name them. */
const KIND_ASKS = [
  { kind: "contract", avoid: "contract", label: "contract roles" },
  { kind: "intern", avoid: "intern", label: "internships" },
] as const;
const KIND_PREFIX = "kind:";

export type Ask = {
  family: string;
  /** stop_track: drop the family from the user's fields; change_fields: open the confirm screen; hide_kind: add the avoid chip. */
  type: "stop_track" | "change_fields" | "hide_kind";
  title: string;
  detail: string;
  yes: string;
  no: string;
  /** What the card says after Yes. */
  done: string;
};

export function familyLabel(family: string) {
  return TRACK_LABELS[family as Track] ?? family;
}

const noteFor = (family: string) => `You skip most ${familyLabel(family)} roles`;

function parseLearned(value: unknown): LearnedLine[] {
  const parsed = learnedSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

const isRank = (line: LearnedLine) => (line.kind ?? "rank") === "rank";

/** The learned lines that act on rank: family → the card's note. Pure; match.ts calls it on the stored JSON. */
export function activeLearned(value: unknown): Map<string, string> {
  return new Map(parseLearned(value).filter((line) => isRank(line) && !line.dismissedAt).map((line) => [line.family, line.note]));
}

/** The stored row's learned lines, under a row lock (one writer at a time: two quick reasons never lose a line). */
async function lockLearned(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<Array<{ learned: unknown }>>`SELECT "learned" FROM "CandidateBrief" WHERE "userId" = ${userId} FOR UPDATE`;
  return rows.length > 0 ? parseLearned(rows[0].learned) : null;
}

async function writeLearned(tx: Prisma.TransactionClient, userId: string, learned: LearnedLine[]) {
  // Only the learned column: the brief, fitHash and the fit lease are never touched, so nothing re-judges.
  await tx.$executeRaw`UPDATE "CandidateBrief" SET "learned" = ${JSON.stringify(learned)}::jsonb WHERE "userId" = ${userId}`;
}

/**
 * Saves the reason on the user's left swipe of this job: inserted when the deck's own POST has not landed yet, updated
 * when it has, never on a right swipe. The family is the job's at this moment, kept if the swipe already has one.
 */
export async function recordReason(userId: string, jobId: string, reason: SkipReason): Promise<{ saved: "ok" | "not_found" | "not_left"; counts: boolean }> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { source: true, title: true, track: true, roleFamily: true, readingCurrent: true, kind: true } });
  if (!job) return { saved: "not_found", counts: false };
  const family = trackOf(job);
  // Whether this skip can move a count (learnFromSkips is worth running): "not my field", or any reason on a kind the
  // agent may offer to hide.
  const kind = job.readingCurrent ? job.kind : null;
  const counts = reason === "not_my_field" || KIND_ASKS.some((ask) => ask.kind === kind);
  const saved = await db.$executeRaw`
    INSERT INTO "Swipe" ("id", "userId", "jobId", "direction", "reason", "family", "createdAt")
    VALUES (${randomUUID()}, ${userId}, ${jobId}, 'left', ${reason}, ${family}, now())
    ON CONFLICT ("userId", "jobId") DO UPDATE SET "reason" = EXCLUDED."reason", "family" = coalesce("Swipe"."family", EXCLUDED."family")
    WHERE "Swipe"."direction" = 'left'`;
  return saved > 0 ? { saved: "ok", counts } : { saved: "not_left", counts: false };
}

type SkipRow = { direction: string; reason: string | null; family: string | null; createdAt: Date; kind: string | null };

/** The last dismissal of each family (a deleted line or an answered ask); counting starts after it. */
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
 * What the user's recent skips say, as a pure decision: the learned lines to add and at most one ask. `now` and the
 * rows are given so learning-test can check it offline.
 */
export function decide(input: { rows: SkipRow[]; learned: LearnedLine[]; tracks: string[]; avoid: string[]; now: number }) {
  const since = dismissals(input.learned);
  const windowStart = input.now - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const counts = (family: string, keep: (row: SkipRow) => boolean) =>
    input.rows.filter((row) => row.createdAt.getTime() > Math.max(windowStart, since.get(family) ?? 0) && keep(row)).length;

  const fields = new Map<string, number>();
  for (const row of input.rows) {
    if (row.direction !== "left" || row.reason !== "not_my_field" || !row.family) continue;
    if (!(TRACKS as readonly string[]).includes(row.family)) continue;
    fields.set(row.family, 0);
  }
  for (const family of fields.keys()) fields.set(family, counts(family, (row) => row.direction === "left" && row.reason === "not_my_field" && row.family === family));

  const lines: LearnedLine[] = [];
  const asks: Ask[] = [];
  const active = new Set(input.learned.filter((line) => isRank(line) && !line.dismissedAt).map((line) => line.family));
  for (const [family, count] of [...fields].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
    if (count < LEARN_AFTER) continue;
    const label = familyLabel(family);
    if (input.tracks.includes(family)) {
      // The last track would come straight back from the skills (tracksOf), so the user picks new fields instead.
      asks.push(
        input.tracks.length > 1
          ? { family, type: "stop_track", title: `Stop showing ${label} roles?`, detail: `You skipped ${count} as not your field.`, yes: "Stop showing", no: "Keep showing", done: `${label} roles are off your feed.` }
          : { family, type: "change_fields", title: "Change your fields?", detail: `You skipped ${count} ${label} roles as not your field.`, yes: "Change fields", no: "Not now", done: "" },
      );
    } else if (!active.has(family)) {
      lines.push({ id: randomUUID(), kind: "rank", family, note: noteFor(family), at: new Date(input.now).toISOString(), dismissedAt: null });
    }
  }

  for (const ask of KIND_ASKS) {
    if (input.avoid.includes(ask.avoid)) continue;
    const family = `${KIND_PREFIX}${ask.kind}`;
    const skipped = counts(family, (row) => row.direction === "left" && row.reason !== null && row.kind === ask.kind);
    const applied = counts(family, (row) => row.direction === "right" && row.kind === ask.kind);
    if (skipped >= LEARN_AFTER && applied === 0) {
      const title = `Hide ${ask.label}?`;
      const done = `${ask.label[0].toUpperCase()}${ask.label.slice(1)} are hidden.`;
      asks.push({ family, type: "hide_kind", title, detail: `You skipped ${skipped} and applied to none.`, yes: "Hide", no: "Keep showing", done });
    }
  }

  // One question at a time, at most one a day: nothing is asked within a day of the last ask.
  const lastAsked = Math.max(0, ...input.learned.filter((line) => line.kind === "ask").map((line) => Date.parse(line.at)));
  const ask = input.now - lastAsked >= ASK_GAP_MS ? (asks[0] ?? null) : null;
  return { lines, ask };
}

/**
 * After a reason: what the skips now say. Adds the new learned lines and records the ask it returns (so the next is a
 * day away). `learned` is true when a line was added (the caller forgets the cached feed so the rank moves).
 */
export async function learnFromSkips(userId: string): Promise<{ ask: Ask | null; learned: boolean }> {
  const [profile, brief] = await Promise.all([
    db.profile.findUnique({ where: { userId }, select: { tracks: true, currentTitle: true, skills: true, experience: true, avoid: true } }),
    db.candidateBrief.findUnique({ where: { userId }, select: { userId: true } }),
  ]);
  // The learned lines live on the brief's row; a user who never had one gets it built now.
  if (profile && !brief) await buildBrief(userId);
  if (!profile) return { ask: null, learned: false };
  const tracks = tracksOf(profile);
  return db.$transaction(async (tx) => {
    const learned = await lockLearned(tx, userId);
    if (!learned) return { ask: null, learned: false };
    const rows = await tx.$queryRaw<SkipRow[]>`
      SELECT s."direction", s."reason", s."family", s."createdAt", CASE WHEN j."readingCurrent" THEN j."kind" END AS "kind"
      FROM "Swipe" s LEFT JOIN "Job" j ON j."id" = s."jobId"
      WHERE s."userId" = ${userId} AND s."createdAt" > now() - make_interval(days => ${WINDOW_DAYS}::int)`;
    const now = Date.now();
    const { lines, ask } = decide({ rows, learned, tracks, avoid: profile.avoid, now });
    if (lines.length === 0 && !ask) return { ask: null, learned: false };
    const next = [...learned, ...lines];
    if (ask) {
      const open = next.find((line) => line.kind === "ask" && line.family === ask.family && !line.dismissedAt);
      if (open) open.at = new Date(now).toISOString();
      else next.push({ id: randomUUID(), kind: "ask", family: ask.family, note: ask.title, at: new Date(now).toISOString(), dismissedAt: null });
    }
    await writeLearned(tx, userId, next);
    return { ask, learned: lines.length > 0 };
  });
}

/**
 * The user's answer to an ask. Either answer closes it and restarts the family's count. Yes on stop_track writes the
 * user's fields without that family (a field change; never the last one); Yes on hide_kind adds the avoid chip.
 * `changed` is true when the profile changed (the caller forgets the feed and prescans).
 */
export async function answerAsk(userId: string, family: string, yes: boolean): Promise<{ found: boolean; changed: boolean }> {
  const profile = await db.profile.findUnique({ where: { userId }, select: { tracks: true, currentTitle: true, skills: true, experience: true, avoid: true } });
  if (!profile) return { found: false, changed: false };
  return db.$transaction(async (tx) => {
    const learned = await lockLearned(tx, userId);
    const open = learned?.find((line) => line.kind === "ask" && line.family === family && !line.dismissedAt);
    if (!learned || !open) return { found: false, changed: false };
    open.dismissedAt = new Date().toISOString();
    await writeLearned(tx, userId, learned);
    if (!yes) return { found: true, changed: false };
    if (family.startsWith(KIND_PREFIX)) {
      const ask = KIND_ASKS.find((item) => `${KIND_PREFIX}${item.kind}` === family);
      if (!ask || profile.avoid.includes(ask.avoid)) return { found: true, changed: false };
      await tx.profile.update({ where: { userId }, data: { avoid: [...profile.avoid, ask.avoid] } });
      return { found: true, changed: true };
    }
    const tracks = tracksOf(profile);
    const rest = tracks.filter((track) => track !== family);
    if (rest.length === 0 || rest.length === tracks.length) return { found: true, changed: false };
    await tx.profile.update({ where: { userId }, data: { tracks: rest } });
    return { found: true, changed: true };
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
