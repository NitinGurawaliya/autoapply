import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { callJson } from "@/lib/llm";
import { classifyTitle, TRACKS, TRACK_LABELS } from "./functions";
import { poolSql } from "./pool";

/**
 * Job reading (Phase P, docs/relevance/TDD.md 4.1.2): the model reads each job of the feed's pool once and says what
 * field it is in, what kind of engagement it is (employee, intern, contract, gig, task), whether it is a paid task or
 * commission only, and which lines of the posting show it and say what the candidate must have. Code keeps only what it
 * can check: every quoted line must be in the posting, and a field, a kind other than employee or a flag without a
 * quoted line is dropped. A reading stays current until the title or description really changes (the job_reading_stale
 * trigger). Nothing in the feed reads these columns yet (P3 does).
 */

export const ROLE_FAMILIES = [...TRACKS, "non_tech"] as const;
export type RoleFamily = (typeof ROLE_FAMILIES)[number];
export const KINDS = ["employee", "intern", "contract", "gig", "task"] as const;
export type JobKind = (typeof KINDS)[number];
export const FLAGS = ["paid_task", "commission_only"] as const;
export type JobFlag = (typeof FLAGS)[number];

/** Characters of the description the model reads (the title is sent apart). */
export const READ_DESCRIPTION_CHARS = 6000;
const BATCH = 10;
// As many batches at once as the background lane allows by default (LLM_BACKGROUND_CONCURRENT).
const PARALLEL = 6;
const MAX_REQUIREMENTS = 4;
const MAX_LINE_CHARS = 240;
const MIN_LINE_CHARS = 8;
const MAX_ATTEMPTS = 3;
const CLAIM_MINUTES = 10;
const RETRY_AFTER_HOURS = 24;
export const READING_VERSION = 3;

const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
/** Midnight of today in India, as a UTC timestamp (the daily budget's day). */
const IST_DAY_START = Prisma.sql`((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC')`;

const lineSchema = z.string().max(2000);
// Values outside the enums are read as null (and then dropped by checkReading), so one stray word does not fail the
// other nine jobs of its batch (P1: 4 of 20 batches failed that way on the first 200 jobs).
const oneOf = <T extends string>(values: readonly T[]) => z.unknown().transform((value): T | null => ((values as readonly unknown[]).includes(value) ? (value as T) : null));
const EVIDENCE_FOR = ["roleFamily", "kind", ...FLAGS] as const;
const resultSchema = z.object({
  n: z.number().int(),
  roleFamily: oneOf(ROLE_FAMILIES),
  kind: oneOf(KINDS),
  flags: z.array(oneOf(FLAGS)).max(6).catch([]),
  summary: z.string().max(600).catch(""),
  evidence: z.array(z.object({ for: oneOf(EVIDENCE_FOR), line: lineSchema })).max(16).catch([]),
  requirements: z.array(lineSchema).max(16).catch([]),
});
export const answerSchema = z.object({ results: z.array(resultSchema) });

const FAMILY_LINES = TRACKS.map((track) => `- ${track}: ${TRACK_LABELS[track]}`).join("\n");

export const READING_SYSTEM = `You read job postings for a job app that serves software, data and AI engineers in India. For each job (its title and the start of its description) say what the job IS, from the posting's own words.

roleFamily: the field of the work the hire will do day to day, one of:
${FAMILY_LINES}
- non_tech: anything else (sales, recruiting, finance, design, operations, teaching, healthcare, civil or mechanical engineering, support that is not engineering...)
Pick from what the hire will do, not from the company's industry or product: a tech company's accountant is non_tech; a bank's backend developer is backend. "software" only for general software engineering that fits no narrower field. null only when the posting does not say what the work is.
Edge cases: IT helpdesk, desktop or end-user support (laptops, printers, MS Office, password resets) is non_tech; support of a software product's customers by engineers is solutions. A business analyst who gathers requirements and writes user stories is non_tech; data_science only when the work is analysing data (SQL, dashboards, statistics, models). Market research, CRM or tool administration, reporting support and operations analysts are non_tech. Product, project and program managers are non_tech. Plant, maintenance, civil and mechanical engineers are non_tech.

kind: employee (a salaried job, full time or part time, the default) | intern (an internship, apprenticeship or trainee programme) | contract (a fixed-term contract, freelance or consulting engagement) | gig (paid per piece of work through a platform: annotation, rating, tutoring sessions, microtasks) | task (an assessment or one-off task posted as a job).
flags: paid_task (the "job" is to do paid tasks, e.g. train or evaluate AI models per task or per hour, on a platform) | commission_only (pay is only commission or revenue share, no salary). Usually none.

evidence: lines copied word for word from the posting that show the roleFamily, the kind when it is not employee, and each flag: [{"for":"roleFamily"|"kind"|"paid_task"|"commission_only","line":"..."}]. Copy exactly, one short sentence or phrase each, at most 240 characters. The title counts as part of the posting.
requirements: up to 4 lines copied word for word from the posting that say what the candidate must have or will do (skills, years, degree, main duties), most important first. Never company boilerplate.
summary: one plain sentence saying what the job is.

Never invent a line: a line not found in the posting is thrown away, and a field, kind or flag without a line is thrown away with it.
Return {"results":[{"n","roleFamily","kind","flags","summary","evidence","requirements"}]} with one entry per job.`;

export type ReadingInput = { title: string; description: string };
export type Reading = {
  roleFamily: RoleFamily | null;
  kind: JobKind | null;
  flags: JobFlag[];
  summary: string;
  evidence: Array<{ for: string; line: string }>;
  requirements: string[];
  /** Lines the model gave that are not in the posting (counted for the report). */
  dropped: number;
};

/** Lowercase, one kind of quote, dash and space: a copied line is checked against the posting in this form. */
export function normalise(text: string) {
  return decodeEntities(text)
    .toLowerCase()
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•·▪●◦]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: "...", bull: " " };

/**
 * HTML entities some boards leave in their text ("8&#xa0;years"), decoded: the model copies what it reads as "8 years",
 * and the check must find it (P1, 19 Nov: 3 of 20 sampled readings lost their field to this).
 */
export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16) || 32);
    if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)) || 32);
    return ENTITIES[lower] ?? match;
  });
}

/** What the model is sent for one job: the title and the first READ_DESCRIPTION_CHARS of the description, one line. */
export function postingText(job: ReadingInput) {
  const clean = (text: string) => decodeEntities(text).replace(/\s+/g, " ").trim();
  return { title: clean(job.title), description: clean(job.description).slice(0, READ_DESCRIPTION_CHARS) };
}

/** A copied line kept only when it is (after normalising, and without its edge punctuation) inside the text sent. */
function verifiedLine(line: string, haystack: string) {
  const trimmed = line.replace(/\s+/g, " ").trim();
  const needle = normalise(trimmed).replace(/^[\s"'\-–—:;,.]+|[\s"'\-–—:;,.]+$/g, "");
  if (needle.length < MIN_LINE_CHARS || trimmed.length > MAX_LINE_CHARS + 20) return null;
  return haystack.includes(needle) ? trimmed.slice(0, MAX_LINE_CHARS) : null;
}

/** The checks of 4.1.2 on one answer: quoted lines must be in the posting; a claim without a line is dropped. */
export function checkReading(job: ReadingInput, answer: z.output<typeof resultSchema>): Reading {
  const sent = postingText(job);
  const haystack = normalise(`${sent.title}\n${sent.description}`);
  let dropped = 0;
  const evidence: Reading["evidence"] = [];
  for (const item of answer.evidence) {
    if (!item.for) continue;
    const line = verifiedLine(item.line, haystack);
    if (line) evidence.push({ for: item.for, line });
    else dropped += 1;
  }
  const requirements: string[] = [];
  for (const raw of answer.requirements) {
    const line = verifiedLine(raw, haystack);
    if (!line) {
      dropped += 1;
      continue;
    }
    if (requirements.length < MAX_REQUIREMENTS && !requirements.includes(line)) requirements.push(line);
  }
  const shown = (target: string) => evidence.some((item) => item.for === target);
  const kind: JobKind | null = answer.kind === "employee" ? "employee" : answer.kind && shown("kind") ? answer.kind : null;
  const flags = [...new Set(answer.flags)].filter((flag): flag is JobFlag => flag !== null && shown(flag));
  // A field whose quoted line failed the check is still kept when the title alone says the same (classifyTitle): the
  // title is then the evidence (P1, 19 Nov: the model paraphrased or invented the line for 2 of 20 sampled jobs).
  const title = classifyTitle(sent.title);
  const titleFamily = title.function === "non_tech" ? "non_tech" : title.track;
  const byTitle = Boolean(answer.roleFamily) && !shown("roleFamily") && answer.roleFamily === titleFamily;
  if (byTitle) evidence.push({ for: "roleFamily", line: sent.title });
  const roleFamily = answer.roleFamily && shown("roleFamily") ? answer.roleFamily : null;
  // Evidence for a claim that was not kept says nothing: drop it with the claim.
  const kept = evidence.filter((item) => (item.for === "roleFamily" ? roleFamily !== null : item.for === "kind" ? kind !== null && kind !== "employee" : flags.includes(item.for as JobFlag)));
  return { roleFamily, kind, flags, summary: answer.summary.trim().slice(0, 300), evidence: kept, requirements, dropped };
}

/** One model call for up to BATCH jobs; a job the model left out is missing from the map. */
export async function readBatch(jobs: ReadingInput[]): Promise<Map<number, Reading>> {
  const payload = jobs.map((job, n) => ({ n, ...postingText(job) }));
  const answer = await callJson(answerSchema, READING_SYSTEM, JSON.stringify({ jobs: payload }), { lane: "background", timeoutMs: 90_000 });
  const out = new Map<number, Reading>();
  for (const result of answer.results) {
    const job = jobs[result.n];
    if (!job || out.has(result.n)) continue;
    out.set(result.n, checkReading(job, result));
  }
  return out;
}

/** How many more jobs may be read today (JOB_READINGS_PER_DAY, counted from readAt since midnight in India). */
export async function readingBudgetLeft() {
  const perDay = Number(process.env.JOB_READINGS_PER_DAY) || 4000;
  const [row] = await db.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "Job" WHERE "readAt" >= ${IST_DAY_START}`;
  return Math.max(0, perDay - (row?.n ?? 0));
}

type Claimed = { id: string; title: string; description: string; hash: string };

/**
 * Claims up to `limit` pool jobs that need a reading, newest first, for CLAIM_MINUTES: two processes never read the
 * same job. A job that failed MAX_ATTEMPTS times waits RETRY_AFTER_HOURS from its last failure.
 */
export async function claimJobs(limit: number, onlyIds?: string[]) {
  return db.$queryRaw<Claimed[]>`
    UPDATE "Job" AS t SET "readClaimedUntil" = ${NOW} + make_interval(mins => ${CLAIM_MINUTES}::int)
    FROM (
      SELECT j.id FROM "Job" j
      WHERE ${poolSql("j")}
        AND (j.reading IS NULL OR NOT j."readingCurrent")
        AND (j."readClaimedUntil" IS NULL OR j."readClaimedUntil" < ${NOW})
        AND NOT (j."readAttempts" >= ${MAX_ATTEMPTS}::int AND j."readFailedAt" > ${NOW} - make_interval(hours => ${RETRY_AFTER_HOURS}::int))
        AND (${onlyIds ?? null}::text[] IS NULL OR j.id = ANY(${onlyIds ?? null}::text[]))
      ORDER BY j."postedAt" DESC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ) AS pick
    WHERE t.id = pick.id
    RETURNING t.id, t.title, t.description, md5(t.title || chr(10) || t.description) AS hash`;
}

/**
 * Writes the readings whose job still has the text that was read (the md5 of title and description), clearing the
 * claim; a job whose text changed meanwhile is skipped and read again later. Returns how many were written.
 */
export async function writeReadings(rows: Array<{ id: string; hash: string; reading: Reading }>) {
  if (rows.length === 0) return 0;
  const data = rows.map(({ id, hash, reading }) => ({
    id,
    hash,
    roleFamily: reading.roleFamily,
    kind: reading.kind,
    flags: reading.flags,
    reading: { version: READING_VERSION, summary: reading.summary, evidence: reading.evidence, requirements: reading.requirements },
  }));
  return db.$executeRaw`
    UPDATE "Job" AS j SET "roleFamily" = v."roleFamily", kind = v.kind,
      flags = ARRAY(SELECT jsonb_array_elements_text(v.flags)), reading = v.reading, "readingCurrent" = true,
      "readAt" = ${NOW}, "readAttempts" = 0, "readFailedAt" = NULL, "readClaimedUntil" = NULL
    FROM jsonb_to_recordset(${JSON.stringify(data)}::jsonb) AS v(id text, hash text, "roleFamily" text, kind text, flags jsonb, reading jsonb)
    WHERE j.id = v.id AND md5(j.title || chr(10) || j.description) = v.hash`;
}

/** A failed read: one more attempt counted, the claim released. */
async function markFailed(ids: string[]) {
  if (ids.length === 0) return;
  await db.$executeRaw`
    UPDATE "Job" SET "readAttempts" = "readAttempts" + 1, "readFailedAt" = ${NOW}, "readClaimedUntil" = NULL
    WHERE id = ANY(${ids}::text[])`;
}

export type ReadResult = { read: number; failed: number; skipped: number; dropped: number; budgetLeft: number };

/**
 * Reads pool jobs that need a reading until `max`, the day's budget or the deadline, PARALLEL batches of BATCH at a
 * time. A failed batch counts an attempt on each of its jobs; the next call takes them again.
 */
export async function readPendingJobs(options: { deadline?: number; max?: number; onlyIds?: string[] } = {}): Promise<ReadResult> {
  const out: ReadResult = { read: 0, failed: 0, skipped: 0, dropped: 0, budgetLeft: await readingBudgetLeft() };
  const max = options.max ?? Infinity;
  while (out.budgetLeft > 0 && out.read + out.failed + out.skipped < max && (!options.deadline || Date.now() < options.deadline)) {
    const take = Math.min(BATCH * PARALLEL, out.budgetLeft, max - out.read - out.failed - out.skipped);
    const claimed = await claimJobs(take, options.onlyIds);
    if (claimed.length === 0) break;
    const batches: Claimed[][] = [];
    for (let i = 0; i < claimed.length; i += BATCH) batches.push(claimed.slice(i, i + BATCH));
    const done: Array<{ id: string; hash: string; reading: Reading }> = [];
    const failed: string[] = [];
    await Promise.all(
      batches.map(async (batch) => {
        try {
          const readings = await readBatch(batch);
          batch.forEach((job, n) => {
            const reading = readings.get(n);
            if (reading) done.push({ id: job.id, hash: job.hash, reading });
            else failed.push(job.id);
          });
        } catch (error) {
          console.error(`job reading: ${error instanceof Error ? error.message.slice(0, 100) : "failed"}`);
          failed.push(...batch.map((job) => job.id));
        }
      }),
    );
    const written = await writeReadings(done);
    await markFailed(failed);
    // A job whose text changed while it was read keeps its claim until it lapses, then is read again.
    out.read += written;
    out.skipped += done.length - written;
    out.failed += failed.length;
    out.dropped += done.reduce((sum, row) => sum + row.reading.dropped, 0);
    out.budgetLeft = Math.max(0, out.budgetLeft - claimed.length);
    // A whole round failing (no API key, the API down) ends the call; the next one tries again.
    if (done.length === 0) break;
  }
  return out;
}

/** How many pool jobs have a current reading, and how many are waiting for one. */
export async function readingCoverage() {
  const [row] = await db.$queryRaw<Array<{ pool: number; current: number; failing: number }>>`
    SELECT count(*)::int AS pool,
           count(*) FILTER (WHERE j.reading IS NOT NULL AND j."readingCurrent")::int AS current,
           count(*) FILTER (WHERE j."readAttempts" >= ${MAX_ATTEMPTS}::int)::int AS failing
    FROM "Job" j WHERE ${poolSql("j")}`;
  return { pool: row.pool, current: row.current, unread: row.pool - row.current, failing: row.failing };
}
