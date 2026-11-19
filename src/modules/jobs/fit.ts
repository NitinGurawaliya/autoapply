import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { callJson, type LlmLane } from "@/lib/llm";
// The brief file itself, not the profile index (which pulls in resume parsing).
import { type Brief, briefJson, FIT_VERSION, fitHashOf } from "@/modules/profile/brief";
import { compareSkills } from "./skills";
import { type Fit, type Judgement, levelOn } from "./semantic";

/**
 * The fit verdict (Phase P, P6; docs/relevance/TDD.md 4.1 item 7), behind RELEVANCE_FIT. Per job the model gets the
 * job's reading (title, family, kind, summary, its requirement lines numbered from 1) and the skills comparison code
 * already makes (the posting's skills the candidate shows, and the ones it asks for that they don't), with the
 * candidate brief (P5), never resume text or the raw posting. It returns `fit`, `why` (at most 12 words) and `evidence`,
 * the number of the requirement line the verdict rests on, checked here. The level (levelOn: years asked, staff or
 * senior titles) is code, applied on top each time a verdict is read, so the cache holds only what the model said.
 * Years phrases are taken out of the lines sent (the diagnosis of 19 Nov: levelOn checks years; the model counted them
 * twice and cited years lines that say nothing about fit); indexes map back to the posting's lines. The model anchored
 * on the brief's one title, so since option A (owner, 19 Nov) the brief also carries the candidate's roles (what they
 * did). A code track floor was tried (v5) and removed: its generic reasons and title-track errors made verdicts worse.
 *
 * Cached in FitJudgement (or the eval's dry-run store), valid while `fitHash` (the brief) and `jobHash` (md5 of the exact
 * per-job JSON sent, without its batch index) are unchanged: a new reading, skills split or label re-judges that job
 * alone. Jobs without a current reading get no verdict (the unjudged path). One build per user at a time by a lease on
 * CandidateBrief.fitBuildUntil (compare-and-set, 3 minutes); verdicts are written per batch, so a second caller reads
 * what is done and judges nothing. A single job (the swipe check) is judged without the lease.
 */

/** RELEVANCE_FIT=1 turns the fit path on (every process at once, TDD 4.9); anything else keeps the old judge. */
export function fitOn() {
  return process.env.RELEVANCE_FIT === "1";
}

/** FIT_MODEL overrides the model for the fit calls only (lib/llm.ts's default otherwise). */
export function fitModel() {
  return process.env.FIT_MODEL?.trim() || null;
}

/** The cache key of a brief's verdicts: FIT_VERSION and the brief exactly as sent, plus the model when overridden. */
export function fitHashFor(brief: Brief) {
  const model = fitModel();
  return fitHashOf(brief, model ? `${FIT_VERSION}|${model}` : FIT_VERSION);
}

export const FIT_BATCH = 10;
const FIT_PARALLEL = 8;
const LEASE_MINUTES = 3;
const WHY_WORDS = 12;

export const fitSchema = z.object({
  results: z.array(
    z.object({
      n: z.number().int(),
      fit: z.enum(["strong", "good", "stretch", "no"]),
      evidence: z.number().int().nullable().optional(),
      why: z.string(),
    }),
  ),
});

export const FIT_SYSTEM = `You judge how well one job seeker fits job postings. You get the candidate (their tracks, years, current title, top skills, and their roles with what they did in each) and numbered jobs. Each job comes with its title, its family, a one-line summary, its requirement lines numbered from 1 (copied from the posting), and a skills check done by code: "have" = the posting's tech skills the candidate shows, "missing" = skills the posting asks for that the candidate does not show.
For each job say how close the WORK is to the candidate's own work, ignoring seniority and years (code checks those). Their tracks and roles say what work they do (the title is only their latest role), so a job in any of their tracks is their own work; their skills list is short, so a skill neither it nor their roles show is unknown, not missing.
- strong: the candidate's own field and specialty (a full-stack developer and a full-stack or web role; a data scientist and a data scientist or analytics role; a security engineer and a security engineering or SOC role).
- good: the same field, a neighbouring specialty or another main stack (data science and ML engineering; backend and full-stack; SOC / detection and application or cloud security; a Node.js backend engineer and a Java backend role).
- stretch: a different specialty they could move into with their skills (a developer and DevOps or QA automation; a data scientist and data engineering).
- no: another kind of work (for a developer: sales, recruiting, product or program management, design, writing, finance, operations; for a data scientist: frontend or mobile engineering; for a web developer: iOS or embedded).
evidence: the number of the ONE requirement line that best shows what the work is (its main skill, stack or duty), for every verdict, "no" included (for "no", the line that shows the other kind of work). null only when the job has no requirement lines.
why: at most 12 words, to the candidate as "you", about the work in that line (e.g. "Java and Spring backend services, close to your backend work", "Detection engineering, next to your SOC work", "An iOS role, not web work"). No years.
Return {"results":[{"n","fit","evidence","why"}]} with one entry per job.`;

/** The job's columns fit.ts reads in its one query (FeedRow carries no reading). */
type FitRowIn = {
  id: string;
  title: string;
  experienceMin: number | null;
  roleFamily: string | null;
  kind: string | null;
  readingCurrent: boolean;
  reading: unknown;
  skills: string[];
  skillsRequired: string[];
  skillsHash: string | null;
  contentHash: string | null;
};

const readingSchema = z.object({ summary: z.string().optional(), requirements: z.array(z.string()).optional() });

// A years-of-experience phrase ("3+ years of experience", "a minimum of five years of professional experience", "0-2
// yrs"): taken out of the lines sent, since the level is code (levelOn).
const NUMBER = String.raw`(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)`;
const YEARS = new RegExp(
  String.raw`(?:\b(?:a\s+)?(?:minimum\s+(?:of\s+)?|at\s+least\s+|min\.?\s*)?)?\b${NUMBER}\s*\+?\s*(?:(?:-|–|to)\s*${NUMBER}\s*\+?\s*)?(?:years?|yrs?)\b(?:\s+of)?(?:\s+(?:professional|relevant|hands-on|industry|work))?(?:\s+experience)?`,
  "gi",
);
const MIN_WORDS = 3;

/** A requirement line as sent: its years phrase removed; null when too little is left to say what the work is. */
export function lineSent(line: string): string | null {
  const left = line.replace(YEARS, " ").replace(/\s+([,.;:)])/g, "$1").replace(/\(\s*\)/g, "").replace(/\s+/g, " ").trim();
  return (left.match(/[A-Za-z][A-Za-z+#.]*/g) ?? []).length >= MIN_WORDS ? left : null;
}

/** What the model is sent about one job (without `n`), or null when the job has no current reading. */
export function fitInput(job: FitRowIn, shows: Set<string>) {
  if (!job.readingCurrent || job.reading == null) return null;
  const reading = readingSchema.safeParse(job.reading);
  if (!reading.success) return null;
  const requirements = reading.data.requirements ?? [];
  // The lines sent, numbered from 1; sentIndex maps each back to its place in the posting's own lines (the quote).
  const kept = requirements.map((line, i) => ({ line: lineSent(line), i })).filter((row): row is { line: string; i: number } => row.line != null);
  // The model's required labels count only while they belong to this version of the posting (match.ts labelledSkills).
  const labelled = job.skillsHash != null && job.skillsHash === (job.contentHash ?? "none");
  const compared = compareSkills(job.skills, labelled ? job.skillsRequired : null, shows);
  // Fixed key order: the hash is of exactly this JSON.
  const sent = {
    title: job.title,
    family: job.roleFamily,
    kind: job.kind,
    summary: reading.data.summary ?? "",
    requirements: kept.map((row, n) => `${n + 1}. ${row.line}`),
    skills: { have: compared.have, missing: compared.missing },
  };
  const json = JSON.stringify(sent);
  return { sent, json, jobHash: createHash("md5").update(json).digest("hex"), requirements, sentIndex: kept.map((row) => row.i) };
}

export type FitVerdict = Judgement & { quote: string | null };
export type FitRow = { jobId: string; fitHash: string; jobHash: string; fit: string; why: string; evidenceIndex: number | null };

/** Where verdicts are cached: FitJudgement for the feed; the eval (P6 dry run) passes its own, which never writes it. */
export type FitStore = {
  read(profileId: string, jobIds: string[]): Promise<FitRow[]>;
  write(profileId: string, fitHash: string, rows: Array<Omit<FitRow, "fitHash">>): Promise<void>;
};

export const fitJudgementStore: FitStore = {
  read: (profileId, jobIds) => db.fitJudgement.findMany({ where: { profileId, jobId: { in: jobIds } }, select: { jobId: true, fitHash: true, jobHash: true, fit: true, why: true, evidenceIndex: true } }),
  async write(profileId, fitHash, rows) {
    if (rows.length === 0) return;
    await db.$executeRaw`
      INSERT INTO "FitJudgement" ("profileId", "jobId", "fitHash", "jobHash", "fit", "why", "evidenceIndex")
      SELECT ${profileId}, r."jobId", ${fitHash}, r."jobHash", r.fit, r.why, r."evidenceIndex"
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r("jobId" text, "jobHash" text, fit text, why text, "evidenceIndex" int)
      WHERE EXISTS (SELECT 1 FROM "Job" j WHERE j.id = r."jobId")
      ON CONFLICT ("profileId", "jobId") DO UPDATE SET "fitHash" = EXCLUDED."fitHash", "jobHash" = EXCLUDED."jobHash", fit = EXCLUDED.fit,
        why = EXCLUDED.why, "evidenceIndex" = EXCLUDED."evidenceIndex", "createdAt" = now()`;
  },
};

/** This process's running totals (warm logs them per run): `evidenceMissed` = verdicts on jobs with requirement lines whose evidence was missing or not a line. */
export const fitStats = { judged: 0, cached: 0, evidenceMissed: 0, no: 0, failed: 0, unread: 0, leaseBusy: 0 };

export const capWords = (text: string) => text.trim().replace(/[.\s]+$/, "").split(/\s+/).slice(0, WHY_WORDS).join(" ");

/** The model's row for one job, with the level (code) on top: what the feed scores with. */
function verdictOf(row: { fit: string; why: string; evidenceIndex: number | null }, job: FitRowIn, requirements: string[], years: number | null): FitVerdict {
  const { fit, note } = levelOn(row.fit as Fit, job.title, job.experienceMin, years);
  // Left out by the level although the work fits: the reason says why, as the old path does.
  const why = fit === "no" && note && row.fit !== "no" ? `${note[0].toUpperCase()}${note.slice(1)}` : row.why;
  const quote = row.evidenceIndex != null ? (requirements[row.evidenceIndex] ?? null) : null;
  return { fit, why: why.slice(0, 140), quote };
}

type BatchJob = { json: string; sentIndex: number[] };

/** The user message: the brief exactly as briefJson sends it, then each job's JSON with its batch index first. */
export function fitMessage(brief: Brief, jobs: BatchJob[]) {
  return `{"candidate":${briefJson(brief)},"jobs":[${jobs.map((job, n) => `{"n":${n},${job.json.slice(1)}`).join(",")}]}`;
}

/** The model's answer checked: one verdict per known index, evidence kept only when it is one of that job's lines. */
export function checkFitAnswer(answer: z.output<typeof fitSchema>, jobs: BatchJob[]) {
  const out = new Map<number, { fit: Fit; why: string; evidenceIndex: number | null; missed: boolean }>();
  for (const result of answer.results) {
    const job = jobs[result.n];
    if (!job || out.has(result.n)) continue;
    const line = result.evidence ?? null;
    const valid = line != null && line >= 1 && line <= job.sentIndex.length;
    out.set(result.n, { fit: result.fit, why: capWords(result.why), evidenceIndex: valid ? job.sentIndex[line - 1] : null, missed: job.sentIndex.length > 0 && !valid });
  }
  return out;
}

/** One call: the model's verdict on each job (by index), evidence checked against the job's own lines. No cache. */
export async function fitBatch(brief: Brief, jobs: BatchJob[], lane: LlmLane = "background") {
  return checkFitAnswer(await callJson(fitSchema, FIT_SYSTEM, fitMessage(brief, jobs), { lane, model: fitModel() ?? undefined }), jobs);
}

/** Takes the user's fit lease for LEASE_MINUTES when free or expired (the brief row is created if missing). */
export async function takeLease(userId: string, brief: Brief) {
  const taken = await db.$executeRaw`
    INSERT INTO "CandidateBrief" ("userId", "brief", "fitHash", "fitBuildUntil", "updatedAt")
    VALUES (${userId}, ${briefJson(brief)}::jsonb, ${fitHashOf(brief)}, now() + make_interval(mins => ${LEASE_MINUTES}::int), now())
    ON CONFLICT ("userId") DO UPDATE SET "fitBuildUntil" = EXCLUDED."fitBuildUntil"
    WHERE "CandidateBrief"."fitBuildUntil" IS NULL OR "CandidateBrief"."fitBuildUntil" < now()`;
  return taken > 0;
}

export const releaseLease = (userId: string) => db.$executeRaw`UPDATE "CandidateBrief" SET "fitBuildUntil" = NULL WHERE "userId" = ${userId}`;

export type FitWho = { userId: string; profileId: string; brief: Brief; shows: Set<string>; years: number | null };
export type FitOptions = {
  store?: FitStore;
  /** Judge jobs with no valid verdict (false: read the cache only). */
  judge?: boolean;
  /** Take the user's lease before judging (the feed's builds); false for a single job and the eval's dry run. */
  lease?: boolean;
  lane?: LlmLane;
};

/**
 * The fit verdict of each of these jobs for this candidate: cached ones read, missing ones judged (unless `judge` is
 * false or another build holds the lease), in batches of FIT_BATCH. Jobs without a current reading, left out by the
 * model, or in a failed batch are missing from the result (the caller scores them unjudged; not cached, so the next
 * build tries again).
 */
export async function fitJobs(who: FitWho, jobIds: string[], options: FitOptions = {}): Promise<Map<string, FitVerdict>> {
  const out = new Map<string, FitVerdict>();
  if (jobIds.length === 0) return out;
  const store = options.store ?? fitJudgementStore;
  const fitHash = fitHashFor(who.brief);
  const [rows, cached] = await Promise.all([
    db.job.findMany({
      where: { id: { in: jobIds } },
      select: { id: true, title: true, experienceMin: true, roleFamily: true, kind: true, readingCurrent: true, reading: true, skills: true, skillsRequired: true, skillsHash: true, contentHash: true },
    }),
    store.read(who.profileId, jobIds),
  ]);
  const valid = new Map(cached.filter((row) => row.fitHash === fitHash).map((row) => [row.jobId, row]));
  const missing: Array<{ job: FitRowIn; json: string; jobHash: string; requirements: string[]; sentIndex: number[] }> = [];
  for (const job of rows) {
    const input = fitInput(job, who.shows);
    if (!input) {
      fitStats.unread += 1;
      continue;
    }
    const row = valid.get(job.id);
    if (row && row.jobHash === input.jobHash) {
      fitStats.cached += 1;
      out.set(job.id, verdictOf(row, job, input.requirements, who.years));
    } else missing.push({ job, json: input.json, jobHash: input.jobHash, requirements: input.requirements, sentIndex: input.sentIndex });
  }
  if (missing.length === 0 || options.judge === false) return out;
  if (options.lease && !(await takeLease(who.userId, who.brief))) {
    fitStats.leaseBusy += 1;
    return out;
  }
  try {
    const batches: (typeof missing)[] = [];
    for (let i = 0; i < missing.length; i += FIT_BATCH) batches.push(missing.slice(i, i + FIT_BATCH));
    for (let i = 0; i < batches.length; i += FIT_PARALLEL) {
      await Promise.all(
        batches.slice(i, i + FIT_PARALLEL).map(async (batch) => {
          try {
            const verdicts = await fitBatch(who.brief, batch, options.lane);
            const fresh: Array<Omit<FitRow, "fitHash">> = [];
            for (const [n, verdict] of verdicts) {
              const { job, jobHash, requirements } = batch[n];
              fitStats.judged += 1;
              if (verdict.missed) fitStats.evidenceMissed += 1;
              if (verdict.fit === "no") fitStats.no += 1;
              fresh.push({ jobId: job.id, jobHash, fit: verdict.fit, why: verdict.why, evidenceIndex: verdict.evidenceIndex });
              out.set(job.id, verdictOf(verdict, job, requirements, who.years));
            }
            // Per batch, so a second caller (or a build after a crash) reads what is done.
            await store.write(who.profileId, fitHash, fresh);
          } catch (error) {
            fitStats.failed += batch.length;
            console.error(`fit: ${error instanceof Error ? error.message.slice(0, 80) : "failed"}`);
          }
        }),
      );
    }
  } finally {
    if (options.lease) await releaseLease(who.userId).catch(() => undefined);
  }
  return out;
}
