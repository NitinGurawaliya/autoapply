import { z } from "zod";
import { callJson } from "@/lib/llm";
import { CONCEPT_IDS, detectConcept, grounded, recall, RISKY, sameParam } from "@/modules/answers";
import type { Recalled } from "@/modules/answers";
import type { FormField } from "./adapter";

/**
 * Retrieve, then verify (ARCHITECTURE 6.19). For questions the resolver could not answer, recall the user's closest past
 * questions, ask the model ONCE per form which saved answer truly answers each one for this job, then check its choice
 * in code. Similarity alone never fills an answer: the T49 experiment showed look-alikes ("our US office" vs "our London
 * office") score higher than real paraphrases. What comes back is a value with source "matched" and its basis.
 */

export type JobContext = { company: string; title: string; location: string; country: string };
/** An answer from memory ("matched", the default) or worked out from the profile and resume ("derived", derive.ts). */
export type MemoryAnswer = { key: string; answer: string; basis: string; score: number; source?: "matched" | "derived" | "ai_draft" };

const verifySchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int(),
      concept: z.enum(CONCEPT_IDS),
      param: z.string().max(120).nullable(),
      match: z.number().int().nullable(),
      matchParam: z.string().max(120).nullable(),
      reason: z.string().max(400),
    }),
  ),
});

const SYSTEM = `You decide whether a job applicant's SAVED answer can be reused for a NEW question on an application form.
Reuse only when the saved question asks for exactly the same fact about the applicant, so the saved answer is correct for the new question as asked for THIS job. Different wording is fine; a different subject is not.
Check the saved ANSWER, not only the wording: it must be a correct, complete answer to the new question exactly as asked. Different parts of one thing are different facts: a month is not a year, a start date is not an end date, a degree is not a major/branch, a graduation date is not a degree, availability (yes/no) is not a term or duration. A yes/no answer never answers a what/which/when/how question, and a list or choice never answers a yes/no question unless it clearly implies it. If two candidates answer it differently, prefer the most recently saved one (savedOn).
Classify each new question's concept: residence, citizenship (citizen, "U.S. person", permanent resident, green card: NOT the same as being allowed to work), work_authorization, needs_sponsorship, willing_to_relocate, office_attendance, previously_employed_by, company_relationship, compensation, notice_period, eeo, or general for anything else.
General questions (how the applicant heard about or found the job, zip code, start date, degree, links, overall experience and the like) are facts about the applicant, not about one employer: reuse them across companies even though the saved answer was given for another job, unless the saved answer itself names that other company or a person there.
residence means asking WHETHER the applicant lives in a particular place ("Do you reside in the US or Canada?"); asking for the applicant's address, city, state or zip code is general.
For citizenship, work_authorization and needs_sponsorship the parameter is a country; for residence, willing_to_relocate and office_attendance a place (city, region or country; for residence it is the place the question asks about, e.g. "the United States or Canada"); for previously_employed_by and company_relationship a company. Questions with a different parameter are NOT the same: "worked at MongoDB" is not "worked at Thoughtworks", "our US office" is not "our London office", "authorized to work in the US" is not "authorized to work in the UK".
- param: the country/place/company the NEW question is about. When it says "this job", "our office", "the country where the job is located" or names no place, use the job given. Null for concepts without a parameter or when it cannot be told.
- match: the number of the saved candidate that answers the new question, or null if none does. Never pick a candidate about a different skill, company, place or country.
- matchParam: the country/place/company the MATCHED saved question was about; when it says "this job" or "our office", use the job it was answered for ("answeredFor"); null if that is unknown.
- reason: one short sentence.
Return {"results":[{"index","concept","param","match","matchParam","reason"}]} with one result per new question.`;

type Candidate = Recalled & { n: number };

// Different parts of one thing are different facts. When two questions each name a part from the same family and the
// parts differ ("End date month" vs "End date year", "degree" vs "major"), one answer cannot serve both.
const PART_FAMILIES = [
  ["day", "month", "year"],
  ["start", "end"],
  ["degree", "major", "minor"],
  ["address", "city", "state", "zip", "country"],
  ["first", "middle", "last", "preferred"],
];
// Words that name the same part: "postal code" is a zip code, a province a state, a branch (of study) a major.
const SAME_PART: Record<string, string> = { postal: "zip", postcode: "zip", pincode: "zip", pin: "zip", province: "state", branch: "major" };
const tokens = (text: string) => new Set(text.toLowerCase().split(/[^a-z]+/).filter(Boolean).map((word) => SAME_PART[word] ?? word));
function differentParts(a: string, b: string) {
  const x = tokens(a);
  const y = tokens(b);
  return PART_FAMILIES.some((family) => {
    const inA = family.filter((part) => x.has(part)).sort().join(",");
    const inB = family.filter((part) => y.has(part)).sort().join(",");
    return inA !== "" && inB !== "" && inA !== inB;
  });
}

// Leading tags such as "[Relocation]" do not change what is asked.
const opening = (question: string) => question.replace(/^\s*\[[^\]]*\]\s*/, "").trim();
const isYesNo = (answer: string) => /^(yes|no|y|n|true|false)\b/i.test(answer.trim());
const asksYesNo = (question: string) => /^(are|do|does|did|have|has|had|is|was|were|will|would|can|could|should|may|might)\b/i.test(opening(question));
const asksOpen = (question: string) => /^(what|which|when|where|who|whom|whose|how|why|please (list|provide|describe|enter|share|specify|select)|list|describe|enter|share|specify)\b/i.test(opening(question));

export async function answerFromMemory(input: {
  userId: string;
  job: JobContext | null;
  fields: FormField[];
  /** Keys whose answers must not be offered (the replay leaves out the question's own answer). */
  excludeKeys?: string[];
}): Promise<{ answers: Map<string, MemoryAnswer>; considered: number; rejected: string[] }> {
  const answers = new Map<string, MemoryAnswer>();
  const rejected: string[] = [];
  const fields = input.fields.filter((field) => field.type !== "file");
  if (fields.length === 0) return { answers, considered: 0, rejected };

  const found = await recall(input.userId, fields.map((field) => field.label), { excludeKeys: input.excludeKeys });
  const questions = fields
    .map((field, index) => ({ index, field, candidates: (found.get(field.label) ?? []).map((row, i): Candidate => ({ ...row, n: i + 1 })) }))
    .filter((question) => question.candidates.length > 0);
  if (questions.length === 0) return { answers, considered: 0, rejected };

  const payload = {
    job: input.job,
    questions: questions.map((question) => ({
      index: question.index,
      question: question.field.label,
      options: question.field.options?.slice(0, 30),
      candidates: question.candidates.map((candidate) => ({
        n: candidate.n,
        question: candidate.question,
        answer: candidate.answer.slice(0, 200),
        answeredFor: candidate.context,
        savedOn: new Date(candidate.updatedAt).toISOString().slice(0, 10),
      })),
    })),
  };
  // A wrong reuse fills a wrong answer, so the verify step may use a stronger model than the rest (one call per form).
  const verdict = await callJson(verifySchema, SYSTEM, JSON.stringify(payload), { model: process.env.OPENAI_VERIFY_MODEL });

  for (const result of verdict.results) {
    const question = questions.find((item) => item.index === result.index);
    if (!question || result.match == null) continue;
    const candidate = question.candidates.find((item) => item.n === result.match);
    const label = question.field.label;
    const refuse = (why: string) => rejected.push(`${label.slice(0, 60)}: ${why}`);
    if (!candidate) {
      refuse("picked a candidate that was not offered");
      continue;
    }
    if (differentParts(label, candidate.question)) {
      refuse("asks for a different part (month/year, start/end, degree/major, city/zip...)");
      continue;
    }
    // The shape of the answer must fit the question: a bare yes/no never answers what/which/when/how, and an open
    // answer to a which/what question never answers a yes/no one.
    if (asksOpen(label) && isYesNo(candidate.answer)) {
      refuse("a yes/no answer cannot answer an open question");
      continue;
    }
    if (asksYesNo(label) && !isYesNo(candidate.answer) && asksOpen(candidate.question)) {
      refuse("an open answer cannot answer a yes/no question");
      continue;
    }
    // The question's own words decide whether it is a risky kind; the model cannot talk a risky question into "general".
    const newKind = detectConcept(label);
    const oldKind = detectConcept(candidate.question);
    const concept = newKind ?? (result.concept === "general" ? null : result.concept);
    if (newKind !== oldKind) {
      refuse(`different kinds of question (${newKind ?? "general"} vs ${oldKind ?? "general"})`);
      continue;
    }
    if (concept) {
      const rule = RISKY[concept];
      if (candidate.source !== "user") {
        refuse(`${concept} answers are reused only from the user's own answers`);
        continue;
      }
      if (rule.parameter) {
        const jobTexts = input.job ? [input.job.company, input.job.location, input.job.country, input.job.title] : [];
        const oldTexts = [candidate.question, candidate.context?.company, candidate.context?.location, candidate.context?.country, candidate.context?.title];
        const ok =
          result.param &&
          result.matchParam &&
          grounded(result.param, [label, ...jobTexts]) &&
          grounded(result.matchParam, oldTexts) &&
          sameParam(result.param, result.matchParam);
        if (!ok) {
          refuse(`${concept} needs the same ${rule.parameter} on both questions (${result.param ?? "?"} vs ${result.matchParam ?? "?"})`);
          continue;
        }
      }
    }
    const where = candidate.context?.company ? ` (${candidate.context.company})` : "";
    answers.set(label, { key: candidate.key, answer: candidate.answer, basis: `your answer to "${candidate.question.slice(0, 120)}"${where}`, score: candidate.score });
  }
  return { answers, considered: questions.length, rejected };
}
