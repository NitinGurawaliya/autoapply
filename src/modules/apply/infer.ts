import { createHash } from "node:crypto";
import { z } from "zod";
import { callJson } from "@/lib/llm";
import { detectConcept, grounded, isCustomQuestionKey, recall, RISKY, sameParam } from "@/modules/answers";
import type { Recalled } from "@/modules/answers";
import { loadRules } from "@/modules/governance";
import { acknowledgementValue } from "./acknowledgement";
import type { FormField } from "./adapter";
import { essayKind } from "./essay";
import { placesNamed } from "./places";
import { asksOpen, asksYesNo, differentParts, isYesNo, type MemoryAnswer } from "./recall";

/**
 * The agent answers what it already knows (30 Oct, owner: "make the agent smart, do not ask the obvious"). It runs after
 * the exact, memory and derived steps, on what they left, in two model passes per form:
 * 1. From the candidate's saved answers: each question with its own closest saved wordings (by meaning, wider than the
 *    memory step) and the candidate's standing facts (expected CTC, notice period...), for the same fact in other words
 *    ("How did you learn about this job?" for "How did you hear about us?") or re-formatted ("Expected CTC 18" for
 *    "What are your salary expectations?" as "18 LPA"). A second, narrow call then confirms each one is the same question.
 * 2. From the profile alone, for what is still open: what it states or plainly implies (a finished degree for "Are you
 *    over 18?", the city for "Which city are you based in?", the LinkedIn link).
 * Kept apart on purpose (30 Oct replay): with everything in one call the model linked look-alikes (a zip code answered
 * "no", "experience with IAM?" from "experience with Kafka?") and cited profile fields as cover for them.
 *
 * The model proposes; code keeps the hard rules (CLAUDE.md), whatever the model says:
 * - every answer cites evidence that exists (pass 1: this question's candidates or the standing facts; pass 2: profile
 *   fields), and every number in it appears in that evidence or is the form's own option (no made-up zip codes or pay);
 * - the shape fits (a yes / no never answers an open question; zip is not address, month is not year: recall.ts);
 * - sensitive keys and risky kinds (pay, notice, work authorization, sponsorship, relocation, office, citizenship,
 *   worked-at...) only from the user's OWN saved answers, a yes / no saying what theirs says; country kinds need the
 *   same country on both sides, read by code; place and company kinds the same grounded parameter (as recall.ts); from
 *   the profile only an open "where do you live"; EEO never;
 * - the profile never gives a "No": a resume's silence proves nothing; labels that are ids, not questions, are skipped.
 * Anything else stays a question for the user.
 */

export type InferJob = { company: string; title: string; location: string; country: string };
export type InferProfile = {
  city: string | null;
  country: string | null;
  yearsExperience: number | null;
  currentTitle?: string | null;
  currentCompany: string | null;
  linkedin?: string | null;
  github?: string | null;
  portfolio?: string | null;
  skills: unknown;
  experience: unknown;
  education?: unknown;
};
type SavedRow = { key: string; question?: string | null; answer: string; source: string; context?: unknown; updatedAt?: Date };

// The model is loose with types now and then: null for "none", a number as text, one field as a plain string
// ("profile": "city"), a field name among the numbered evidence, "answer": true. Read what it meant; anything else drops
// the item (that question is asked).
const list = z.union([z.array(z.union([z.number(), z.string()])), z.number(), z.string()]).nullish().transform((items) => (items == null ? [] : Array.isArray(items) ? items : [items]));
const itemSchema = z
  .object({
    index: z.coerce.number().int(),
    answer: z.union([z.string().max(1000), z.number(), z.boolean()]).nullish().transform((value) => (value == null ? null : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value))),
    evidence: list,
    profile: list,
    param: z.string().max(120).nullish().transform((text) => text ?? null),
    evidenceParam: z.string().max(120).nullish().transform((text) => text ?? null),
    reason: z.string().max(300).nullish().transform((text) => text ?? ""),
  })
  .transform((item) => {
    const all = [...item.evidence, ...item.profile];
    return {
      ...item,
      evidence: all.map((value) => Number(value)).filter((value) => Number.isInteger(value)),
      profile: all.filter((value): value is string => typeof value === "string" && !/^\d+$/.test(value.trim())).map((value) => value.trim().slice(0, 40)),
    };
  });
// One malformed item (a bare string now and then) must not lose the whole form: it is skipped, so that question is asked.
const resultSchema = z.object({
  results: z.array(z.unknown()).transform((items) => items.flatMap((item) => {
    const parsed = itemSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  })),
});

const COMMON = `Never invent: no address, zip code, number, date, name, link or preference the data does not state. When options are listed, answer with one option's exact text (several, comma-separated, only for a multi-select). Answer null when the data does not settle it; the candidate is then asked. Return {"results":[...]} with exactly one result for EVERY question index, in order.`;

const FROM_SAVED = `You fill in a job application for a candidate from what they told us before, so they are not asked the same thing twice.
Known: their STANDING FACTS (numbered saved answers such as expected CTC, notice period, start date) and for each question its own CANDIDATES (numbered saved answers to the most similar past questions). Use only these.
Reuse one when its question asks for the same fact as the new question, in other words or units ("How did you learn about this job?" answers "How did you hear about us?"; "Expected CTC 12" answers "What are your salary expectations?"), re-formatted for the new question ("12" lakh a year as "12 LPA"; a date in the asked format; the matching option). Similar words are not enough: a zip code is not an address line, a Codeforces rating is not a Codechef rating, experience with one tool is not experience with another. A yes/no answer never answers a what/which/where/how question. A question about a particular country, place or company is answered only from one about that same country, place or company (use the job for "this role", "our office", "the country where the job is"). If two disagree, use the newest (savedOn).
${COMMON}
Each result: index; answer (or null); evidence: the numbers it comes from; param: the country/place/company the question is about, else null; evidenceParam: the one the used saved answer was about (its question, or the job it was answered for), else null; reason: one short sentence.`;

const FROM_PROFILE = `You fill in a job application for a candidate from their PROFILE (taken from their resume), so they are not asked what it already states.
Answer only what the profile states or plainly implies: where they live (city, country), their links, degree, school, graduation year, employers, titles, skills, years of experience; a finished degree or a year of work means over 18. A preference (relocation, remote, on site, travel) is never in a profile. Never answer "No" because the profile does not mention something: a resume leaves most things out.
${COMMON}
Each result: index; answer (or null); profile: the profile fields it comes from (e.g. "city", "education", "linkedin"); reason: one short sentence.`;

const CONFIRM = `For each item: a job application asks NEW QUESTION; we want to fill it with the candidate's SAVED ANSWER to SAVED QUESTION (as PROPOSED ANSWER). Is that correct? "same" is true only when the saved question asks for the very same fact about the candidate, so the proposed answer is right for the new question exactly as asked. Different wording, units or format are fine: in India the expected CTC IS the salary expectation and the current CTC the current salary or compensation; the notice period answers how soon the candidate can join; how they learned of a job is how they heard of it. It is false when they are about different things: a different skill, tool, company, place, time, program or part ("experience with IAM" vs "experience with Kafka"; "Codechef rating" vs "Codeforces rating"; "zip code" vs "address"; "which terms are you available" vs "internship duration"). When in doubt, false. Return {"results":[{"i","same"}]} with one result per item.`;
const confirmSchema = z.object({ results: z.array(z.object({ i: z.coerce.number().int(), same: z.boolean() })) });

const yesNo = (text: string) => (/^\s*(yes|y|true)\b/i.test(text) ? "yes" : /^\s*(no|n|false|none)\b/i.test(text) ? "no" : null);
const numbers = (text: string): string[] => text.match(/\d+(?:\.\d+)?/g) ?? [];
const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
// "null", "N/A", "unknown" written as the answer mean the model has none (30 Oct replay: "null" was about to be typed in).
const NO_ANSWER = /^(null|none|n\/?a|na|unknown|not (stated|available|provided|specified))\.?$/i;
// A place or company, not a way of working: "onsite" on both sides matched two different internships (30 Oct).
const NOT_A_PLACE = /^(on-?site|office|the office|our office|in[- ]person|remote|remotely|hybrid|home|anywhere|this (job|role|position|location)|the job|job location|work ?place)$/i;

// Candidates per question: the closest saved wordings by meaning, looser than the memory step (recall.ts, 0.54), since
// the model, the confirming call and the checks below decide.
const CANDIDATES = 8;
const MIN_SCORE = 0.45;

type Question = { index: number; question: string; type: string; options?: string[] };
type Result = z.infer<typeof itemSchema>;

/** One model pass; questions it leaves out (it does now and then) are asked once more on their own. */
async function pass(system: string, body: Record<string, unknown>, questions: Array<Question & Record<string, unknown>>): Promise<Result[]> {
  const ask = async (items: typeof questions) => {
    const text = JSON.stringify({ ...body, questions: items });
    return (await callJson(resultSchema, system, text, { cacheKey: `infer:${createHash("sha256").update(system + text).digest("hex")}`, model: process.env.OPENAI_VERIFY_MODEL })).results;
  };
  const results = await ask(questions);
  const missing = questions.filter((question) => !results.some((result) => result.index === question.index));
  if (missing.length > 0) {
    // Numbered 0..n-1 on their own (the model renumbers otherwise), then mapped back to the form's numbers.
    const again = await ask(missing.map((question, index) => ({ ...question, index })));
    for (const result of again) if (missing[result.index]) results.push({ ...result, index: missing[result.index].index });
  }
  return results;
}

/** Answers for these still-open fields, by label; what the data does not settle is left out (asked). */
export async function inferAnswers(input: {
  userId: string;
  fields: FormField[];
  /** The user's saved answers; their standing facts (canonical keys) are offered to every question. */
  answers: SavedRow[];
  profile: InferProfile;
  job: InferJob | null;
  /** Keys whose answers must not be offered (the replay leaves out the question's own answer). */
  excludeKeys?: string[];
}): Promise<{ answers: Map<string, MemoryAnswer>; rejected: string[] }> {
  const out = new Map<string, MemoryAnswer>();
  const rejected: string[] = [];
  const sensitive = new Set(loadRules().sensitive_keys_never_ai);
  // Essays are drafted (essay.ts), acknowledgements follow the standing permission, files are uploads, EEO keeps its
  // default, and a label that is no question at all (an id such as "e44c00b3-feb7-…": an email was typed into one).
  const fields = input.fields.filter(
    (field) =>
      field.type !== "file" &&
      !essayKind(field.label, field.type) &&
      !acknowledgementValue(field) &&
      detectConcept(field.label) !== "eeo" &&
      /[a-z]{3,}.*\b[a-z]{2,}\b/i.test(field.label.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "")),
  );
  if (fields.length === 0) return { answers: out, rejected };
  const questions: Question[] = fields.map((field, index) => ({ index, question: field.label, type: field.type, options: field.options?.slice(0, 40) }));

  // Checks every answer goes through, wherever it came from: the shape fits, and no number is made up.
  const fits = (field: FormField, answer: string, evidence: string, savedQuestions: string[]) => {
    const isOption = !!field.options?.some((option) => norm(option) === norm(answer));
    if (asksOpen(field.label) && isYesNo(answer) && !isOption) return "a yes/no answer to an open question";
    if (savedQuestions.some((question) => differentParts(field.label, question))) return "a saved answer about a different part (zip/address, month/year...)";
    if (asksYesNo(field.label) && !isYesNo(answer) && !isOption && savedQuestions.length > 0 && savedQuestions.every((question) => asksOpen(question))) return "an open answer to a yes/no question";
    if (!isOption && numbers(answer).some((n) => !numbers(evidence).includes(n))) return "a number not in the evidence";
    return null;
  };

  // ---- Pass 1: from the saved answers.
  // The user's standing facts (canonical keys: pay, notice period, start date...) go to every question: their short
  // wordings sit far from the many ways forms ask ("Expected CTC" scored under 0.3 against "What are your salary
  // expectations?"). Then each question's own closest wordings. Never standing permissions, agent keys or AI drafts.
  let next = 0;
  const skip = new Set(input.excludeKeys ?? []);
  const standing = input.answers
    .filter((row) => !isCustomQuestionKey(row.key) && !skip.has(row.key) && !/^accept_|^essay_/.test(row.key) && row.source !== "ai_draft" && row.answer.trim() && row.question?.trim())
    .map((row) => ({ id: row.key, key: row.key, question: row.question ?? row.key, answer: row.answer, source: row.source, context: (row.context ?? null) as Recalled["context"], updatedAt: row.updatedAt ?? new Date(0), score: 1, n: ++next }));
  const found = await recall(input.userId, fields.map((field) => field.label), { limit: CANDIDATES, minScore: MIN_SCORE, excludeKeys: input.excludeKeys });
  const offered = fields.map((field) => (found.get(field.label) ?? []).filter((row) => row.source !== "ai_draft" && row.answer.trim() && isCustomQuestionKey(row.key)).map((row) => ({ ...row, n: ++next })));
  const saved = (row: { n: number; question: string; answer: string; context: unknown; updatedAt: Date }) => ({ n: row.n, question: row.question.slice(0, 300), answer: row.answer.slice(0, 300), answeredFor: row.context ?? null, savedOn: new Date(row.updatedAt).toISOString().slice(0, 16) });
  const reused: Array<{ label: string; saved: string; savedAnswer: string; answer: string }> = [];
  if (standing.length > 0 || offered.some((rows) => rows.length > 0)) {
    const results = await pass(FROM_SAVED, { job: input.job, standingFacts: standing.map(saved) }, questions.map((question) => ({ ...question, candidates: offered[question.index].map(saved) })));
    for (const result of results) {
      const field = fields[result.index];
      const answer = result.answer?.trim();
      if (!field || !answer || NO_ANSWER.test(answer)) continue;
      const label = field.label;
      const refuse = (why: string) => rejected.push(`${label.slice(0, 60)}: ${why}`);
      const mine = [...standing, ...offered[result.index]];
      // Only the standing facts and this question's own candidates; a number from another question's list is dropped.
      let used = result.evidence.map((n) => mine.find((row) => row.n === n)).filter((row): row is (typeof mine)[number] => !!row);
      // An answer copied word for word with no (or a wrong) citation: the candidate that holds exactly that text. Never for
      // a yes / no: any "Yes" would do.
      if (used.length === 0 && norm(answer).length >= 3 && yesNo(answer) === null) used = mine.filter((row) => norm(row.answer) === norm(answer)).slice(0, 1);
      if (used.length === 0) {
        refuse("no saved answer behind it");
        continue;
      }
      const misfit = fits(field, answer, used.map((row) => `${row.question} ${row.answer}`).join(" "), used.map((row) => row.question));
      if (misfit) {
        refuse(misfit);
        continue;
      }
      const kind = detectConcept(label);
      const own = used.filter((row) => row.source === "user");
      if (kind || used.some((row) => sensitive.has(row.key))) {
        if (own.length === 0) {
          refuse(`${kind ?? used[0].key} only from your own saved answers`);
          continue;
        }
        // A yes / no must say what the user's answer says.
        const said = own.map((row) => yesNo(row.answer)).find((value) => value !== null);
        if (said && yesNo(answer) && yesNo(answer) !== said) {
          refuse(`${kind ?? used[0].key}: says ${yesNo(answer)}, your answer says ${said}`);
          continue;
        }
        const parameter = kind ? RISKY[kind].parameter : null;
        if (parameter === "country") {
          // Countries are read by code, not taken from the model: those the question names, else the job's; for the saved
          // answer those its question names, else the job it was given for. "IN" must not be grounded by the word "in"
          // (30 Oct: a US sponsorship "Yes" passed as India's).
          const known = (code: unknown) => (code === "IN" || code === "US" ? (code as string) : null);
          const countriesOf = (text: string, fallback: unknown) => {
            const named = [...placesNamed(text).codes].sort();
            return named.length > 0 ? named.join(",") : known(fallback);
          };
          const asked = countriesOf(label, input.job?.country);
          if (!own.some((row) => asked !== null && countriesOf(row.question, row.context?.country) === asked)) {
            refuse(`${kind} needs an answer you gave about the same country (${asked ?? "unknown"})`);
            continue;
          }
        } else if (parameter) {
          const real = (param: string | null): param is string => !!param && param.trim().length >= 3 && !NOT_A_PLACE.test(param.trim());
          const jobTexts = input.job ? [input.job.company, input.job.location, input.job.country, input.job.title] : [];
          const oldTexts = own.flatMap((row) => [row.question, row.context?.company, row.context?.location, row.context?.country, row.context?.title]);
          const ok = real(result.param) && real(result.evidenceParam) && grounded(result.param, [label, ...jobTexts]) && grounded(result.evidenceParam, oldTexts) && sameParam(result.param, result.evidenceParam);
          if (!ok) {
            refuse(`${kind} needs the same ${parameter} on both questions (${result.param ?? "?"} vs ${result.evidenceParam ?? "?"})`);
            continue;
          }
        }
      }
      out.set(label, { key: used[0].key, answer, basis: `your answer to "${used[0].question.slice(0, 120)}": ${result.reason.slice(0, 140)}`, score: 1, source: "matched" });
      reused.push({ label, saved: used[0].question, savedAnswer: used[0].answer, answer });
    }
  }

  // A second, narrow look at every answer taken from another question, one question per item and nothing else to weigh;
  // whatever it does not confirm is asked.
  if (reused.length > 0) {
    try {
      const check = await callJson(confirmSchema, CONFIRM, JSON.stringify({ items: reused.map((item, i) => ({ i, newQuestion: item.label, savedQuestion: item.saved, savedAnswer: item.savedAnswer.slice(0, 300), proposedAnswer: item.answer.slice(0, 300) })) }), { model: process.env.OPENAI_VERIFY_MODEL });
      reused.forEach((item, i) => {
        if (check.results.find((result) => result.i === i)?.same === true) return;
        out.delete(item.label);
        rejected.push(`${item.label.slice(0, 60)}: "${item.saved.slice(0, 50)}" is not the same question`);
      });
    } catch {
      for (const item of reused) out.delete(item.label);
      rejected.push(`could not double-check ${reused.length} reused answers; asking instead`);
    }
  }

  // ---- Pass 2: from the profile, for what is still open.
  const p = input.profile;
  const profile = {
    city: p.city, country: p.country, yearsExperience: p.yearsExperience, currentTitle: p.currentTitle ?? null, currentCompany: p.currentCompany,
    linkedin: p.linkedin ?? null, github: p.github ?? null, portfolio: p.portfolio ?? null,
    skills: Array.isArray(p.skills) ? p.skills.slice(0, 60) : [],
    experience: (Array.isArray(p.experience) ? p.experience : []).slice(0, 12).map((r) => { const role = r as Record<string, unknown>; return { title: role.title, company: role.company, start: role.start, end: role.end }; }),
    education: (Array.isArray(p.education) ? p.education : []).slice(0, 6).map((r) => { const school = r as Record<string, unknown>; return { school: school.school, degree: school.degree, year: school.year }; }),
  };
  // Never sensitive or risky kinds from a profile, except an open "where do you live" (the profile's place is a fact).
  const open = questions.filter((question) => {
    if (out.has(question.question)) return false;
    const kind = detectConcept(question.question);
    return !kind || (kind === "residence" && asksOpen(question.question));
  });
  if (open.length > 0) {
    const results = await pass(FROM_PROFILE, { profile }, open);
    for (const result of results) {
      const field = fields[result.index];
      const answer = result.answer?.trim();
      if (!field || !answer || NO_ANSWER.test(answer) || out.has(field.label)) continue;
      const label = field.label;
      const refuse = (why: string) => rejected.push(`${label.slice(0, 60)}: ${why}`);
      let cited = result.profile.filter((name) => name in profile && (profile as Record<string, unknown>)[name] != null);
      // When the model cited none: the profile fields that hold exactly this text, or each of its comma-separated parts
      // ("Bengaluru, India" is the city and the country).
      if (cited.length === 0 && norm(answer).length >= 3 && yesNo(answer) === null) {
        const parts = answer.split(",").map(norm).filter(Boolean);
        const holders = parts.map((part) => Object.entries(profile).find(([, value]) => typeof value === "string" && norm(value) === part)?.[0]);
        if (holders.every((name): name is string => !!name)) cited = [...new Set(holders)];
      }
      if (cited.length === 0) {
        refuse("no profile field behind it");
        continue;
      }
      if (yesNo(answer) === "no") {
        refuse("a No from what the resume does not mention");
        continue;
      }
      const kind = detectConcept(label);
      if (kind && !(kind === "residence" && cited.every((name) => name === "city" || name === "country"))) {
        refuse(`${kind} is not answered from the resume`);
        continue;
      }
      const misfit = fits(field, answer, cited.map((name) => JSON.stringify((profile as Record<string, unknown>)[name])).join(" "), []);
      if (misfit) {
        refuse(misfit);
        continue;
      }
      out.set(label, { key: "", answer, basis: `from your ${cited.join(", ")}: ${result.reason.slice(0, 140)}`, score: 1, source: "derived" });
    }
  }
  return { answers: out, rejected };
}
