import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { z } from "zod";
import { callJson, embed } from "@/lib/llm";
import { seniorityOf } from "./functions";
import { requiredYears } from "./tagging";

/**
 * Matching by meaning (owner, 10 Oct): every job and every resume becomes a vector once (OpenAI embeddings, 512
 * dimensions, stored as halfvec in Postgres), and how close a job is to the resume decides whether it is the
 * candidate's field and most of its score (match.ts). Works for any role without rules per role; facts stay rules
 * (India eligibility, years asked, level). Every step fails safe: no vector means the job waits, or the profile is
 * matched by its tracks instead. Closeness alone does not tell a product manager's job from a developer's well (both
 * near 0.5 for a developer's resume, 10 Oct), so the closest jobs are then judged by the model against the resume
 * (judgeJobs), once per resume and posting.
 */

export const SEMANTIC_DIMENSIONS = 512;
const JOB_TEXT_CHARS = 2000;
const BATCH = 200;

/** What a job is embedded from: its title, then the start of its description (usually the role and its requirements). */
export function jobText(job: { title: string; description: string }) {
  return `${job.title}\n${job.description.replace(/\s+/g, " ").slice(0, JOB_TEXT_CHARS)}`;
}

type Role = { title?: unknown; company?: unknown; summary?: unknown };
type Degree = { degree?: unknown; field?: unknown; school?: unknown };
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** What a resume is embedded from: titles, skills, roles and degrees. Never contact details (name, email, phone). */
export function profileText(profile: { currentTitle: string | null; yearsExperience: number | null; skills: unknown; experience: unknown; education: unknown }) {
  const skills = Array.isArray(profile.skills) ? profile.skills.filter((s): s is string => typeof s === "string") : [];
  const roles = Array.isArray(profile.experience) ? (profile.experience as Role[]) : [];
  const degrees = Array.isArray(profile.education) ? (profile.education as Degree[]) : [];
  return [
    profile.currentTitle ? `${profile.currentTitle}${profile.yearsExperience != null ? `, ${profile.yearsExperience} years of experience` : ""}` : "",
    skills.length ? `Skills: ${skills.join(", ")}` : "",
    ...roles.slice(0, 6).map((role) => [str(role.title), str(role.summary).slice(0, 400)].filter(Boolean).join(": ")),
    ...degrees.slice(0, 2).map((d) => [str(d.degree), str(d.field)].filter(Boolean).join(", ")),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);
}

const literal = (vector: number[]) => `[${vector.map((x) => x.toFixed(5)).join(",")}]`;

/**
 * Embeds open jobs that have no vector yet (new, or changed since: ingest clears it), India-eligible ones first, up to
 * `max` per call. Returns how many were embedded.
 */
export async function embedPendingJobs(max = 20000) {
  let done = 0;
  while (done < max) {
    const rows = await db.$queryRaw<Array<{ id: string; title: string; description: string }>>`
      SELECT id, title, description FROM "Job"
      WHERE embedding IS NULL AND "closedAt" IS NULL AND source <> 'mock'
      ORDER BY (eligibility IN ('india', 'remote_india')) DESC, "postedAt" DESC
      LIMIT ${Math.min(BATCH, max - done)}`;
    if (rows.length === 0) break;
    const vectors = await embed(rows.map(jobText), { dimensions: SEMANTIC_DIMENSIONS });
    await db.$executeRaw`
      UPDATE "Job" j SET embedding = v.e::halfvec
      FROM unnest(${rows.map((row) => row.id)}::text[], ${vectors.map(literal)}::text[]) AS v(id, e)
      WHERE j.id = v.id`;
    done += rows.length;
  }
  return done;
}

/** Drops the vectors of jobs whose text changed, so embedPendingJobs makes new ones. */
export async function forgetJobVectors(ids: string[]) {
  if (ids.length === 0) return;
  await db.$executeRaw`UPDATE "Job" SET embedding = NULL WHERE id = ANY(${ids}::text[])`;
}

type ProfileForVector = { id: string; currentTitle: string | null; yearsExperience: number | null; skills: unknown; experience: unknown; education: unknown; embeddedFrom?: string | null };

/**
 * The resume's vector as a pgvector literal, made again only when the text it comes from changed. Null when it cannot
 * be made (no API key, the API is down): the caller then matches by tracks.
 */
export async function profileVector(profile: ProfileForVector): Promise<string | null> {
  const text = profileText(profile);
  if (!text) return null;
  const hash = createHash("md5").update(text).digest("hex");
  if (profile.embeddedFrom === hash) {
    const rows = await db.$queryRaw<Array<{ v: string | null }>>`SELECT embedding::text AS v FROM "Profile" WHERE id = ${profile.id}`;
    if (rows[0]?.v) return rows[0].v;
  }
  try {
    const [vector] = await embed([text], { dimensions: SEMANTIC_DIMENSIONS });
    const value = literal(vector);
    await db.$executeRaw`UPDATE "Profile" SET embedding = ${value}::halfvec, "embeddedFrom" = ${hash} WHERE id = ${profile.id}`;
    return value;
  } catch (error) {
    console.error(`profile vector: ${error instanceof Error ? error.message.slice(0, 80) : "failed"}`);
    return null;
  }
}

/** How close one job is to the resume (cosine similarity), or null when either has no vector. */
export async function jobSimilarity(jobId: string, vector: string | null) {
  if (!vector) return null;
  const rows = await db.$queryRaw<Array<{ s: number | null }>>`
    SELECT CASE WHEN embedding IS NULL THEN NULL ELSE 1 - (embedding <=> ${vector}::halfvec) END AS s FROM "Job" WHERE id = ${jobId}`;
  return rows[0]?.s ?? null;
}

export type Fit = "strong" | "good" | "stretch" | "no";
export type Judgement = { fit: Fit; why: string };

const judgeSchema = z.object({
  results: z.array(z.object({ n: z.number().int(), field: z.enum(["same", "close", "related", "different"]), why: z.string() })),
});
const JUDGE_BATCH = 40;
const JUDGE_PARALLEL = 4;

// Part of the cache key: a change to the prompt or the rules judges every job again.
const JUDGE_VERSION = "6";
// The model says only how close the work is (what it is good at); the level is code (levelFit), measured on
// scripts/judge-test.ts: asked to apply years and levels itself, gpt-4o-mini got the arithmetic wrong.
const JUDGE_SYSTEM = `You match one job seeker with job postings. You get the candidate's resume summary and numbered jobs (title and the start of what the job needs). For each job say only how close the WORK is to the candidate's own work, ignoring seniority and years:
- same: the candidate's own field and specialty (a full-stack developer and a full-stack or web role; a data scientist and a data scientist or analytics role).
- close: the same field, a neighbouring specialty (data science and ML engineering; backend and full-stack; SOC / detection and application or cloud security; frontend and mobile).
- related: a different specialty they could move into with their skills (a developer and DevOps or QA automation; a data scientist and data engineering).
- different: another kind of work (for a developer: sales, recruiting, product or program management, design, writing, finance, operations; for a data scientist: frontend or mobile engineering).
Judge skills only from the summary; do not assume skills it does not list.
"why": at most 10 words, spoken to the candidate as "you", about the work only (e.g. "React and Node full-stack work, like yours", "A sales role, not engineering").
Return {"results":[{"n","field","why"}]} with one entry per job.`;

type JudgedJob = { title: string; description: string };
const jobBrief = (job: JudgedJob, n: number) => ({ n, title: job.title, needs: job.description.replace(/\s+/g, " ").slice(0, 600) });

const ORDER: Fit[] = ["no", "stretch", "good", "strong"];
const atMost = (fit: Fit, cap: Fit) => ORDER[Math.min(ORDER.indexOf(fit), ORDER.indexOf(cap))];
const FROM_FIELD: Record<"same" | "close" | "related" | "different", Fit> = { same: "strong", close: "good", related: "stretch", different: "no" };

/**
 * The verdict from how close the work is (the model) and the level (code): years asked over the candidate's cap it
 * (1 more → good at best, 2 → stretch, 3+ → no); staff, lead or manager titles need 4+ years; senior titles need 3+
 * (2 → stretch); intern and entry roles are not for 5+ years. Returns the fit and what to add to the reason.
 */
export function levelFit(field: keyof typeof FROM_FIELD, job: JudgedJob, years: number | null): { fit: Fit; note: string | null } {
  let fit = FROM_FIELD[field];
  if (fit === "no") return { fit, note: null };
  const have = years ?? 0;
  const asks = requiredYears(job.title, job.description);
  const more = asks == null ? 0 : Math.round(asks - have);
  const level = seniorityOf(job.title);
  let note: string | null = null;
  if (more >= 3) return { fit: "no", note: `asks ${more} more years than you have` };
  if (more === 2) fit = atMost(fit, "stretch");
  if (more === 1) fit = atMost(fit, "good");
  if (more > 0) note = `asks ${more} more ${more === 1 ? "year" : "years"} than you have`;
  if ((level === "staff" || level === "manager") && have < 4) return { fit: "no", note: `a ${level === "staff" ? "staff or lead" : "manager"} role` };
  if (level === "staff" || level === "manager") fit = atMost(fit, "stretch");
  if (level === "senior" && have < 2) return { fit: "no", note: "a senior role" };
  if (level === "senior" && have < 3) fit = atMost(fit, "stretch");
  if ((level === "intern" || level === "entry") && have >= 5) return { fit: "no", note: `an ${level === "intern" ? "intern" : "entry-level"} role` };
  return { fit, note };
}

/** One call: the verdict on each of these jobs (by index) for this candidate. No cache (judgeJobs caches). */
export async function judgeBatch(candidate: { summary: string; years: number | null }, jobs: JudgedJob[]): Promise<Map<number, Judgement>> {
  const verdict = await callJson(judgeSchema, JUDGE_SYSTEM, JSON.stringify({ candidate: candidate.summary.slice(0, 2500), jobs: jobs.map(jobBrief) }));
  const out = new Map<number, Judgement>();
  for (const result of verdict.results) {
    if (result.n < 0 || result.n >= jobs.length || out.has(result.n)) continue;
    const { fit, note } = levelFit(result.field, jobs[result.n], candidate.years);
    const why = result.why.trim().replace(/[.\s]+$/, "");
    // A job kept despite a gap already says so in its score's reason ("Asks for about 3+ years, you have 1"); one
    // left out says why instead of what the work is.
    const reason = fit === "no" && note && result.field !== "different" ? `${note[0].toUpperCase()}${note.slice(1)}` : why;
    out.set(result.n, { fit, why: reason.slice(0, 140) });
  }
  return out;
}

/**
 * The model's verdict for each job against this resume, cached in JobJudgement until the resume or the posting
 * changes. Jobs the model leaves out, or a failed call, are missing from the result (the caller scores them by
 * closeness alone, more strictly).
 */
export async function judgeJobs(
  profile: { id: string; embeddedFrom?: string | null } & Parameters<typeof profileText>[0],
  jobs: Array<{ id: string; title: string; description: string; contentHash: string | null }>,
): Promise<Map<string, Judgement>> {
  const out = new Map<string, Judgement>();
  if (jobs.length === 0) return out;
  const summary = profileText(profile);
  const fromHash = createHash("md5").update(`${JUDGE_VERSION}\n${profile.yearsExperience ?? ""}\n${summary}`).digest("hex");
  const hashOf = (job: { contentHash: string | null }) => job.contentHash ?? "none";
  const cached = await db.jobJudgement.findMany({ where: { profileId: profile.id, jobId: { in: jobs.map((job) => job.id) } } });
  const valid = new Map(cached.map((row) => [row.jobId, row]));
  const missing = jobs.filter((job) => {
    const row = valid.get(job.id);
    if (row && row.fromHash === fromHash && row.jobHash === hashOf(job)) {
      out.set(job.id, { fit: row.fit as Fit, why: row.why });
      return false;
    }
    return true;
  });
  const batches: (typeof missing)[] = [];
  for (let i = 0; i < missing.length; i += JUDGE_BATCH) batches.push(missing.slice(i, i + JUDGE_BATCH));
  const fresh: Array<{ jobId: string; fit: Fit; why: string; jobHash: string }> = [];
  for (let i = 0; i < batches.length; i += JUDGE_PARALLEL) {
    await Promise.all(
      batches.slice(i, i + JUDGE_PARALLEL).map(async (batch) => {
        try {
          const verdicts = await judgeBatch({ summary, years: profile.yearsExperience }, batch);
          for (const [n, judgement] of verdicts) {
            const job = batch[n];
            if (out.has(job.id)) continue;
            out.set(job.id, judgement);
            fresh.push({ jobId: job.id, jobHash: hashOf(job), ...judgement });
          }
        } catch (error) {
          console.error(`judge jobs: ${error instanceof Error ? error.message.slice(0, 80) : "failed"}`);
        }
      }),
    );
  }
  if (fresh.length > 0) {
    await db.$transaction([
      db.jobJudgement.deleteMany({ where: { profileId: profile.id, jobId: { in: fresh.map((row) => row.jobId) } } }),
      db.jobJudgement.createMany({ data: fresh.map((row) => ({ profileId: profile.id, fromHash, ...row })), skipDuplicates: true }),
    ]);
  }
  return out;
}
