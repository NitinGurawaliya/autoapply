import { z } from "zod";
import { callJson } from "@/lib/llm";
import { detectConcept } from "@/modules/answers";

/**
 * Essay questions ("Why do you want to work here?", "Tell us about a project you're proud of") drafted by AI (T55), a
 * product decision: candidates write these with AI anyway. Rules:
 * - only after the user's one-time permission (`accept_ai_essays`), like acknowledgements;
 * - only from the resume and the job: a draft that names an organisation, school or product absent from both is thrown
 *   away and the question is asked;
 * - "best project" is drafted once, saved as an editable answer (`essay_best_project`) and reused everywhere;
 *   "why this company" is drafted per application and not saved;
 * - at most `max_ai_drafts_per_application` drafts per application (config/rules.json); the rest are asked.
 * Never for factual or sensitive questions (the risky kinds in modules/answers/concepts.ts).
 */

export const ESSAY_PERMISSION_KEY = "accept_ai_essays";
export const BEST_PROJECT_KEY = "essay_best_project";
export const ESSAY_PERMISSION_QUESTION =
  "Some forms ask open questions such as \"Why do you want to work here?\" or \"Tell us about a project you're proud of\". May SwipeApply draft these answers for you from your resume and the job? Drafts are marked as AI drafts, never invent facts, and your \"best project\" draft is saved where you can edit it.";

export type EssayKind = "best_project" | "motivation" | "other";

const BEST_PROJECT = /(best|favou?rite|most (impressive|challenging|interesting|complex|meaningful)|proud(est)?)\b.{0,60}\b(project|system|product|thing|work)|(project|system|product)\b.{0,40}\b(proud|built|shipped|led)\b|describe a (project|system) you/i;
const MOTIVATION = /why (do you want|would you like|are you interested|are you applying|did you apply|this (role|company|position|job|team|opportunity))|why (us|join|here)\b|what (excites|interests|draws|attracts|motivates) you|interest(ed)? in (working|joining|this)|motivat/i;
const OTHER = /tell us (about|why|how)|describe (a|your|how|the)|what makes you|walk us through|share (a|an|your)/i;

/** The essay kind of a free-text question, or null when it is not an essay (or is a factual / sensitive question). */
export function essayKind(label: string, type: string): EssayKind | null {
  if (type !== "textarea" && type !== "text") return null;
  if (detectConcept(label)) return null;
  if (BEST_PROJECT.test(label)) return "best_project";
  if (MOTIVATION.test(label)) return "motivation";
  if (type === "textarea" && OTHER.test(label)) return "other";
  return null;
}

export type EssayProfile = { fullName: string; currentTitle: string | null; skills: unknown; experience: unknown; education: unknown };
export type EssayJob = { company: string; title: string; description: string };

const draftSchema = z.object({
  results: z.array(z.object({ index: z.number().int(), text: z.string().max(2500), mentions: z.array(z.string().max(120)) })),
});

const SYSTEM = `You write short answers to open questions on a job application, in the applicant's own voice (first person).
Use ONLY facts in the applicant's resume and, for why-this-company questions, the job posting. Never invent a project, metric, employer, school, title, technology, date or number. If the resume has little to say, write less, plainly.
80 to 160 words, plain and specific, no greeting, no sign-off, no buzzwords, no headings, no lists.
For a "best project" question: describe one real project from the resume, what the applicant did and the outcome stated there.
For a "why this company" question: connect what the resume shows to what the posting says about the role and company.
"mentions": every organisation, school, product or technology name used in the text, exactly as written.
Return {"results":[{"index","text","mentions"}]}.`;

const words = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim()} `;

/** True when every name the draft uses appears in the resume or the job: anything else may be invented. */
export function draftIsGrounded(text: string, mentions: string[], sources: string[]) {
  const corpus = words(sources.join(" "));
  const named = new Set(mentions.map((m) => m.trim()).filter(Boolean));
  // Also catch organisations the model did not list: "X University", "X Inc", "X Labs", "X College"...
  for (const match of text.matchAll(/\b([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)*\s+(?:University|College|Institute|Inc\.?|Labs|Technologies|Corporation|Corp\.?|Ltd\.?|LLC))\b/g)) named.add(match[1]);
  if (![...named].every((name) => corpus.includes(words(name)))) return false;
  // Every number must be one the resume or the job states ("40 store managers", "2024"): an invented metric such as
  // "cut load time by 70%" fails here even when the model did not list it.
  const sourceNumbers = new Set([...sources.join(" ").matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]));
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].every((m) => sourceNumbers.has(m[0]));
}

/** Drafts for these essay questions; only drafts that pass draftIsGrounded are returned (by index). */
export async function draftEssays(input: { profile: EssayProfile; resumeText: string; job: EssayJob; items: Array<{ label: string; kind: EssayKind }> }) {
  const out = new Map<number, string>();
  if (input.items.length === 0) return out;
  const resume = {
    name: input.profile.fullName,
    title: input.profile.currentTitle,
    skills: input.profile.skills,
    experience: input.profile.experience,
    education: input.profile.education,
    text: input.resumeText.slice(0, 6000),
  };
  const job = { company: input.job.company, title: input.job.title, posting: input.job.description.slice(0, 3000) };
  const verdict = await callJson(draftSchema, SYSTEM, JSON.stringify({ resume, job, questions: input.items.map((item, index) => ({ index, question: item.label, kind: item.kind })) }));
  const sources = [input.resumeText, JSON.stringify(resume), input.job.company, input.job.title, input.job.description];
  for (const result of verdict.results) {
    if (result.index < 0 || result.index >= input.items.length) continue;
    const text = result.text.trim();
    if (text.length < 40) continue;
    if (!draftIsGrounded(text, result.mentions, sources)) continue;
    out.set(result.index, text);
  }
  return out;
}
