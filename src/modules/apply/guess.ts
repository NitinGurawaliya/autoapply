import { createHash } from "node:crypto";
import { z } from "zod";
import { callJson } from "@/lib/llm";
import type { FormField } from "./adapter";
import type { MemoryAnswer } from "./recall";

/**
 * Guess and send (4 Nov, owner): "our priority is that applications go, not that every answer is exact". After every
 * other step (exact and saved answers, memory, what the resume proves, inference, essay drafts, option re-wording), each
 * required question still open gets the answer most likely true for this candidate, from their resume, profile, own
 * saved answers and the job, instead of stopping the application to ask. 39% of applications stopped to ask in the
 * week before (61 of 155, 128 answers typed). Each guess is filled as source "guessed" with its reason and shown
 * dashed on the application page; the user's correction there is their answer from then on. Guesses are never saved to
 * the answer bank, so a guess is never reused as if the user had said it.
 *
 * Never guessed (a guess there is a false statement, not an approximation): identity documents and numbers, date of
 * birth, criminal record, signatures, EEO (those keep "Decline to answer"). The model proposes; code checks the answer
 * fits the field: one of its options, a number for a number box, plain text of sane length.
 */

// Disability in Indian forms' words too ("Specially abled" was guessed No on 3SC, 4 Nov), and health. Whole words where a
// word could hide inside another: "e-sign" matched "design" and "Resigned", which dropped two
// questions without a word (4 Nov fresh-user run).
const NEVER = /date of birth|\bd\.?o\.?b\b|birth ?date|aadha?a?r|\bpan\b|passport|social security|\bssn\b|national (id|insurance)|tax (id|number)|\bgst\b|criminal|convict|felony|arrest|offen[cs]e|signature|sign (here|below)|\be-?sign\b|\bgender\b|\brace\b|ethnic|veteran|disabilit|(specially|differently)[- ]abled|\bpwd\b|physically (challenged|handicapped)|handicap|medical (condition|history|background)|health condition|pronoun|sexual orientation|religio|\bcaste\b/i;

const SYSTEM = `You fill in the last open questions of a job application for a candidate, so it can be sent without asking them. Give your best answer to EVERY question: the one most likely true for this candidate, from everything given (their resume, profile, own saved answers to other questions, the job). A close, sensible answer is better than none.
- Options listed (numbered from 1): answer with exactly one option's full text, copied as written (several, comma-separated, only for a multi-select). Pick the closest: for a list of offices or cities the one nearest the candidate's city, else one in their country; for a subject or degree list the nearest to theirs; for "how did you hear" a job-board or careers-site option ("LinkedIn", "Job board", "Company website", "Other").
- Yes/no about a skill, tool, platform or kind of work: Yes when the resume shows it or something close (a related tool, the same field); No when nothing related is there.
- How many years or how much experience with something: from the resume's roles and projects that use it, rounded; 0, or the lowest option, when none.
- The candidate's situation: willing to relocate, work on site or hybrid, commute, travel, work shifts: Yes, unless their saved answers say otherwise. Authorized to work or needs sponsorship: from their citizenship and saved answers for the job's country (a citizen of the job's country is authorized and needs none). Relatives or conflicts of interest, government or political positions, a non-compete, worked at this company before (unless the resume shows it): No. Over 18, able to do the job's essential duties, agrees to a background check: Yes.
- Referral questions (who referred you, how do you know the candidate, employee name): "Not applicable", or the closest option.
- Short text (reason for change, gap, notice, anything else): one or two plain first-person sentences from the resume and saved answers. Never make up a name, company, number, date or link.
- Number boxes: a plain number. Dates: the format the question shows, else YYYY-MM-DD; a start date is today plus their notice period.
- Pay in another currency: their saved pay converted at today's rate, a plain number.
Return {"results":[{"index","answer","basis"}]} with exactly one result per question index; basis: a few words on why ("resume lists AWS at Acme", "nearest office to Bengaluru", "no related experience on the resume").`;

const resultSchema = z.object({
  results: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const parsed = z
        .object({
          index: z.coerce.number().int(),
          answer: z.union([z.string().max(2000), z.number(), z.boolean()]).nullish().transform((value) => (value == null ? "" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value).trim())),
          basis: z.string().max(400).nullish().transform((text) => (text ?? "").trim()),
        })
        .safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
// Placeholders for "no answer". "None", "N/A" and "Not applicable" are real answers to a text question ("Relatives at
// Druva?", "Last working day if serving notice?"), so they stay (4 Nov fresh-user run: both had been dropped and asked).
const EMPTY = /^(null|undefined|unknown|not (stated|available|provided|specified))\.?$/i;
const FUTURE = /\b(join|joining|start|starting|available|availability|lwd|last working|relieving|notice)\b/i;
const words = (text: string) => new Set(norm(text).split(/[^a-z0-9]+/).filter((word) => word.length > 1));

/** The option an answer means: its exact text, its number in the list, or the one sharing most of its words. */
function optionFor(options: string[], wanted: string): string | null {
  // The options are shown numbered ("2. No", "1. 3-5"); the number the model may copy is not part of the option.
  const unnumbered = wanted.replace(/^\s*\d{1,3}[.)]\s+/, "");
  if (unnumbered !== wanted) {
    const listed = options.find((option) => norm(option) === norm(unnumbered));
    if (listed) return listed;
    if (!options.some((option) => /^\d/.test(option.trim()))) wanted = unnumbered;
  }
  const exact = options.find((option) => norm(option) === norm(wanted)) ?? options.find((option) => norm(option).startsWith(norm(wanted)) || norm(wanted).startsWith(norm(option)));
  if (exact) return exact;
  const index = wanted.trim().match(/^(?:option\s*)?(\d{1,3})[.)]?$/i);
  if (index && !options.some((option) => /^\d/.test(option.trim()))) return options[Number(index[1]) - 1] ?? null;
  const want = words(wanted);
  if (want.size === 0) return null;
  let best: { option: string; score: number } | null = null;
  for (const option of options) {
    const have = words(option);
    const shared = [...want].filter((word) => have.has(word)).length;
    const score = shared / Math.max(1, Math.min(want.size, have.size));
    if (!best || score > best.score) best = { option, score };
  }
  return best && best.score >= 0.6 ? best.option : null;
}

export type GuessProfile = {
  city: string | null;
  country: string | null;
  yearsExperience: number | null;
  currentTitle?: string | null;
  currentCompany: string | null;
  skills: unknown;
  experience: unknown;
  education?: unknown;
  resumeText: string;
};
type SavedRow = { key: string; question?: string | null; answer: string; source: string; updatedAt?: Date };

/** Whether a question may be guessed at all (the never-guess list above). */
export function guessable(field: Pick<FormField, "label" | "type">) {
  return field.type !== "file" && !NEVER.test(field.label);
}

/** The model's answer, if it fits the field: an option of the form, a number for a number box, sane plain text. */
export function fitGuess(field: Pick<FormField, "type" | "options" | "label">, answer: string, today = new Date()): string | null {
  const text = answer.trim();
  if (!text) return null;
  // A date for when the candidate can start, join or leave is never in the past: the model wrote 2024-08-03 for a last
  // working day "30 days from today" (4 Nov fresh-user run). Such a guess is refused and the question asked.
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso && FUTURE.test(field.label) && new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`).getTime() < today.getTime() - 86_400_000) return null;
  if (field.options?.length) {
    const wanted = field.type === "checkbox-group" ? text.split(/\s*[,\n]\s*/) : [text];
    const picked = wanted.map((want) => optionFor(field.options!, want)).filter((option): option is string => !!option);
    return picked.length ? [...new Set(picked)].join(", ") : null;
  }
  if (EMPTY.test(text)) return null;
  if (field.type === "number") return /\d/.test(text) ? text.match(/\d+(?:\.\d+)?/)![0] : null;
  return text.slice(0, 1500);
}

/** Best guesses for these open fields, by label; a field the model leaves out or answers unfittingly stays asked. */
export async function guessAnswers(input: {
  fields: FormField[];
  profile: GuessProfile;
  answers: SavedRow[];
  job: { company: string; title: string; location: string; country: string; description: string };
  today?: Date;
}): Promise<Map<string, MemoryAnswer>> {
  const fields = input.fields.filter(guessable);
  const out = new Map<string, MemoryAnswer>();
  if (fields.length === 0) return out;
  const { profile, job } = input;
  // The user's own answers first, newest first; drafts and defaults are not facts about them.
  const saved = input.answers
    .filter((row) => row.source === "user" || row.source === "resume")
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))
    .slice(0, 60)
    .map((row) => ({ question: (row.question || row.key).slice(0, 160), answer: row.answer.slice(0, 200) }));
  const body = {
    today: (input.today ?? new Date()).toISOString().slice(0, 10),
    job: { company: job.company, title: job.title, location: job.location, country: job.country, description: job.description.slice(0, 1500) },
    candidate: {
      city: profile.city,
      country: profile.country,
      yearsExperience: profile.yearsExperience,
      currentTitle: profile.currentTitle ?? null,
      currentCompany: profile.currentCompany,
      skills: profile.skills,
      experience: profile.experience,
      education: profile.education ?? null,
    },
    saved,
    resume: profile.resumeText.slice(0, 6000),
    questions: fields.map((field, index) => ({ index, question: field.label.slice(0, 400), type: field.type, ...(field.options?.length ? { options: field.options.slice(0, 120).map((option, n) => `${n + 1}. ${option}`) } : {}) })),
  };
  const ask = async (questions: typeof body.questions) => {
    const text = JSON.stringify({ ...body, questions });
    return (await callJson(resultSchema, SYSTEM, text, { cacheKey: `guess:${createHash("sha256").update(SYSTEM + text).digest("hex")}` })).results;
  };
  const results = await ask(body.questions);
  // Questions the model left out (it does now and then: 4 Nov, CertifyOS and Anblicks) are asked once more on their
  // own, numbered 0..n-1 there and mapped back.
  const missing = body.questions.filter((question) => !results.some((result) => result.index === question.index));
  if (missing.length > 0) {
    const again = await ask(missing.map((question, index) => ({ ...question, index })));
    for (const result of again) if (missing[result.index]) results.push({ ...result, index: missing[result.index].index });
  }
  for (const result of results) {
    const field = fields[result.index];
    if (!field || out.has(field.label)) continue;
    const answer = fitGuess(field, result.answer, input.today);
    // GUESS_DEBUG=1: why a guess was not used (dry runs only; it prints the model's answer).
    if (!answer && process.env.GUESS_DEBUG === "1") console.log(`guess refused: "${field.label.slice(0, 60)}" (${field.type}) -> ${JSON.stringify(result.answer).slice(0, 120)}${field.options?.length ? ` options ${JSON.stringify(field.options).slice(0, 200)}` : ""}`);
    if (!answer) continue;
    out.set(field.label, { key: "", answer, basis: `best guess: ${result.basis || "from your resume and answers"}`.slice(0, 300), score: 1, source: "guessed" });
  }
  return out;
}
