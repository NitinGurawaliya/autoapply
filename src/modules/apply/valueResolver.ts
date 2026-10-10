import { customQuestionKey, detectConcept, getAnswerKey, matchKeyBySynonym, RISKY } from "@/modules/answers";
import { loadRules } from "@/modules/governance";
import { ACKNOWLEDGEMENT_KEY, ACKNOWLEDGEMENT_QUESTION, acknowledgementValue } from "./acknowledgement";
import { abroadAnswer } from "./abroad";
import type { FormField, PendingQuestion, ResolvedValue } from "./adapter";
import { BEST_PROJECT_KEY, essayKind, ESSAY_PERMISSION_KEY, ESSAY_PERMISSION_QUESTION } from "./essay";
import type { MemoryAnswer } from "./recall";
import { outsideHome, SPONSORSHIP_ABROAD_KEY, SPONSORSHIP_ABROAD_OPTIONS, sponsorshipAbroadQuestion, standingSponsorship } from "./sponsorship";

type AnswerRow = { key: string; answer: string; source: string; context?: unknown };

type ProfileFacts = {
  fullName: string;
  email: string;
  phone: string | null;
  city: string | null;
  country: string | null;
  linkedin: string | null;
  github: string | null;
  portfolio: string | null;
  yearsExperience: number | null;
  currentTitle: string | null;
  currentCompany: string | null;
  resumeKey: string;
};

function profileValue(profile: ProfileFacts, key: string) {
  const [first = "", ...rest] = profile.fullName.trim().split(/\s+/);
  const values: Record<string, string | null> = {
    first_name: first || null,
    last_name: rest.join(" ") || null,
    full_name: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    city: profile.city,
    country: profile.country,
    linkedin: profile.linkedin,
    github: profile.github,
    portfolio: profile.portfolio,
    years_experience: profile.yearsExperience == null ? null : String(profile.yearsExperience),
    current_title: profile.currentTitle,
    current_company: profile.currentCompany,
    resume: profile.resumeKey.split("/").pop() ?? "resume.pdf",
  };
  const value = values[key];
  return value && value.trim() ? value : null;
}

const DECLINE = /decline|don.?t wish|do not wish|prefer not|not (to )?(say|disclose|answer|self.?identify)|choose not/i;

/** "years" and "year", "LPA" and "lpa" are the same unit. */
function unit(text: string | undefined) {
  return (text ?? "").trim().toLowerCase().replace(/s$/, "");
}

/**
 * "1" against ["0-2", "3-5", "10+"] → "0-2"; "12 LPA" against ["5-10 LPA", "10-15 LPA"] → "10-15 LPA". Only when
 * the value is a number, its unit is the options' unit (a bare number also fits ranges in years), and exactly one
 * range holds it: arithmetic, not a judgement, so no model is needed.
 */
export function numericRange(value: string, options: string[]) {
  const parsed = value.trim().match(/^(\d+(?:\.\d+)?)\s*([a-z%]+)?$/i);
  if (!parsed) return null;
  const n = Number(parsed[1]);
  const valueUnit = unit(parsed[2]);
  const sameUnit = (optionUnit: string | undefined) => unit(optionUnit) === valueUnit || (!valueUnit && unit(optionUnit) === "year");
  const hits = options.filter((option) => {
    const between = option.match(/^\s*(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*([a-z%]+)?\s*$/i);
    if (between) return sameUnit(between[3]) && n >= Number(between[1]) && n <= Number(between[2]);
    const plus = option.match(/^\s*(\d+(?:\.\d+)?)\s*\+\s*([a-z%]+)?\s*$/i);
    return plus ? sameUnit(plus[2]) && n >= Number(plus[1]) : false;
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Number inputs refuse anything else: "30 days" → "30"; "Immediate" or "2-3 years" do not fit. */
function fitNumber(value: string) {
  return value.trim().match(/^[^\d-]*(-?\d+(?:\.\d+)?)\D*$/)?.[1] ?? null;
}

/** Map a value onto the form's own options. Null means the value does not fit, so the user must answer. */
// Forms mix plain and non-breaking spaces in the same option text, so compare with all whitespace collapsed.
function norm(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function fitOption(value: string, options: string[] | undefined, eeo: boolean) {
  if (!options || options.length === 0) return value;
  const target = norm(value);
  const exact = options.find((option) => norm(option) === target);
  if (exact) return exact;
  if (eeo) return options.find((option) => DECLINE.test(option)) ?? null;
  const range = numericRange(value, options);
  if (range) return range;
  const starts = options.filter((option) => norm(option).startsWith(target));
  return starts.length === 1 ? starts[0] : null;
}

/** An answer we had for a field but could not place on its options (the runner may re-word it, optionMap.ts). */
export type UnfitAnswer = { label: string; answer: string; options: string[]; key: string; sensitive: boolean };

/** Lookup key for a re-worded answer: the same answer on the same question. */
export const optionKey = (label: string, answer: string) => `${label}\u0000${answer}`;

const EEO_KEYS = new Set(["gender", "race", "ethnicity", "veteran_status", "disability", "pronouns"]);

/** Sensitive and EEO answers may only be re-worded, never changed into a different fact (optionMap.ts). */
function sensitiveOrEeo(key: string, label: string) {
  return loadRules().sensitive_keys_never_ai.includes(key) || EEO_KEYS.has(key) || detectConcept(label) !== null;
}

/** Words that make a question depend on the job it appears on. "We / our / us" only in lower case ("US" is a country). */
function refersToTheJob(label: string) {
  // "The country where you will be working" points at the job; "the country where you currently reside" does not.
  return (
    /\b(this|the) (job|role|position|opportunity|company|team|location)\b|country (where|in which) (you (will|would) (be )?work|you'll (be )?work)|you are applying|you('| a)re applying|\bthe office\b/i.test(label) ||
    /\b(we|our|us)\b/.test(label)
  );
}

export function resolveValues(
  mapped: Array<{ field: FormField; key: string | null }>,
  profile: ProfileFacts,
  answers: AnswerRow[],
  /** Answers recalled from the user's other questions and verified for this job (recall.ts), by field label. */
  memory?: Map<string, MemoryAnswer>,
  /** A known answer re-worded onto this form's own option (optionMap.ts), by optionKey(label, answer). */
  optionMatches?: Map<string, string>,
  /** The job being applied to: a "why this company" answer is only reused for the same company; its country decides
   * whether the standing sponsorship answer applies (sponsorship.ts). */
  job?: { company: string; country?: string },
) {
  const rules = loadRules();
  const bank = new Map(answers.map((row) => [row.key, row]));
  const values: ResolvedValue[] = [];
  const pending: PendingQuestion[] = [];
  // Answers we had but could not place on the form's options; the runner may map them (optionMap.ts) and resolve again.
  const unfit: UnfitAnswer[] = [];

  for (const item of mapped) {
    const { field } = item;
    // The canonical free-text key is for "additional information / anything else". A question the mapper only guessed
    // is free text ("Why do you want this job?") is about one company: never share one saved answer across companies.
    // It is asked and saved under the question's own key, like any other question the canonical keys do not cover.
    const canonicalFreeText = field.selector === "#free_text" || matchKeyBySynonym(field.label) === "free_text" || field.hintKey === "free_text";
    const key = item.key === "free_text" && !canonicalFreeText ? null : item.key;
    const questionKey = customQuestionKey(field.label);
    const ask = (askKey: string) => {
      if (!field.required) return;
      const options = field.type === "checkbox" ? ["Yes", "No"] : field.options;
      pending.push({ key: askKey, label: field.label, type: field.type, options, required: true });
    };
    const push = (valueKey: string, raw: string, source: string, eeo = false) => {
      let value = field.type === "file" ? raw : field.type === "number" ? fitNumber(raw) : fitOption(raw, field.options, eeo);
      let reworded = false;
      if (value == null && field.options?.length) {
        const mapped = optionMatches?.get(optionKey(field.label, raw));
        if (mapped && field.options.includes(mapped)) {
          value = mapped;
          reworded = true;
        } else if (!unfit.some((item) => item.label === field.label && item.answer === raw)) {
          unfit.push({ label: field.label, answer: raw, options: field.options, key: valueKey, sensitive: sensitiveOrEeo(valueKey, field.label) });
        }
      }
      if (value == null) return false;
      if (reworded) {
        values.push({ key: valueKey, label: field.label, value, source, selector: field.selector, type: field.type, required: field.required, basis: `your answer "${raw.slice(0, 60)}", as this form's option` });
        return true;
      }
      values.push({
        key: valueKey,
        label: field.label,
        value,
        source,
        selector: field.selector,
        type: field.type,
        required: field.required,
        fileName: valueKey === "resume" ? raw : undefined,
      });
      return true;
    };

    // A question about a particular country, company or place ("authorized to work in the country where this job is
    // located", "worked at MongoDB", "our London office") may only reuse an answer verified to be about the same one
    // (recall.ts checks the job each answer was given for). Neither a global saved answer nor the same wording given
    // for another job is enough, so for these only the verified memory answer counts; otherwise the user is asked.
    const kind = detectConcept(field.label);
    if (kind && RISKY[kind].parameter) {
      // The same wording is the same question only when it names its own subject ("employed by any government entity",
      // "worked at MongoDB"); one that points at the job ("this role", "our office", "the country where the job is
      // located") means something different for every job, so even the exact wording needs the verified memory answer.
      const exact = !refersToTheJob(field.label) ? bank.get(questionKey) : undefined;
      if (exact && exact.source === "user" && push(key ?? questionKey, exact.answer, exact.source)) continue;
      const verified = memory?.get(field.label);
      if (verified && push(key ?? questionKey, verified.answer, verified.source ?? "matched")) {
        values[values.length - 1].basis = verified.basis;
        continue;
      }
      // Relocating or working on site abroad, work authorization abroad, citizenship lists: from the user's standing
      // answers, each asked once (abroad.ts).
      const abroad = abroadAnswer({ kind, label: field.label, options: field.options, required: field.required, profile, jobCountry: job?.country, bank: (k) => bank.get(k) });
      if (abroad && "ask" in abroad) {
        if (!pending.some((q) => q.key === abroad.ask.key)) pending.push(abroad.ask);
        continue;
      }
      if (abroad && push(key ?? questionKey, abroad.answer, abroad.source)) {
        values[values.length - 1].basis = abroad.basis;
        continue;
      }
      // Sponsorship for a job outside the candidate's home country: their one answer for everywhere abroad, asked
      // once (sponsorship.ts). "It depends on the country" keeps the per-country question.
      if (kind === "needs_sponsorship" && outsideHome(profile.country, job?.country)) {
        const standing = bank.get(SPONSORSHIP_ABROAD_KEY);
        const value = standingSponsorship(standing?.answer);
        if (standing && value && push(key ?? questionKey, value, standing.source)) {
          values[values.length - 1].basis = `your answer: you ${value === "Yes" ? "need" : "do not need"} visa sponsorship outside ${profile.country}`;
          continue;
        }
        if (!standing) {
          if (field.required && !pending.some((q) => q.key === SPONSORSHIP_ABROAD_KEY)) {
            pending.push({ key: SPONSORSHIP_ABROAD_KEY, label: sponsorshipAbroadQuestion(profile.country ?? "your country"), type: "select", options: SPONSORSHIP_ABROAD_OPTIONS, required: true });
          }
          continue;
        }
      }
      ask(questionKey);
      continue;
    }

    // Essay questions (essay.ts). "Why this role / why us" is about one company, so neither a global free-text answer
    // nor the same wording answered for another company counts: only an answer given for this company, or a draft
    // written for this application. Other essays may reuse the user's answer to the same wording or the saved "best
    // project". Without those: the one-time permission, then the runner drafts it (Yes) or the user answers (No).
    const essay = essayKind(field.label, field.type);
    if (essay) {
      // A field whose id IS the canonical free-text key (our mock form) keeps its saved answer when there is one.
      const canonical = canonicalFreeText && key === "free_text" ? bank.get("free_text") : undefined;
      if (canonical && push("free_text", canonical.answer, canonical.source)) continue;
      const exact = bank.get(questionKey);
      // "Why us" reuses the same wording only for the same company: the answer was given for it, or the question names it.
      const sameCompany =
        !!exact &&
        !!job?.company &&
        ((exact.context as { company?: string } | null | undefined)?.company?.toLowerCase() === job.company.toLowerCase() ||
          ` ${field.label.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `.includes(` ${job.company.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `));
      if (exact && (essay !== "motivation" || sameCompany) && push(questionKey, exact.answer, exact.source)) continue;
      const saved = essay === "best_project" ? bank.get(BEST_PROJECT_KEY) : undefined;
      if (saved && push(BEST_PROJECT_KEY, saved.answer, saved.source)) {
        values[values.length - 1].basis = "your saved best-project answer";
        continue;
      }
      const draft = memory?.get(field.label);
      if (draft && (draft.source === "ai_draft" || essay !== "motivation") && push(draft.key || questionKey, draft.answer, draft.source ?? "matched")) {
        values[values.length - 1].basis = draft.basis;
        continue;
      }
      if (!bank.get(ESSAY_PERMISSION_KEY)) {
        if (field.required && !pending.some((q) => q.key === ESSAY_PERMISSION_KEY)) {
          pending.push({ key: ESSAY_PERMISSION_KEY, label: ESSAY_PERMISSION_QUESTION, type: "select", options: ["Yes", "No"], required: true });
        }
        continue;
      }
      ask(questionKey);
      continue;
    }

    // The user's answer to this exact question beats anything inferred from a canonical key.
    const own = bank.get(questionKey);
    if (own && push(key ?? questionKey, own.answer, own.source)) continue;

    // The same fact, saved under another wording, verified to apply to this job.
    const recalled = memory?.get(field.label);
    if (recalled && push(key ?? questionKey, recalled.answer, recalled.source ?? "matched")) {
      values[values.length - 1].basis = recalled.basis;
      continue;
    }

    // Privacy notices, "my answers are true" and arbitration acknowledgements: ticked with the user's standing
    // permission, asked once for that permission when it is missing, asked one by one if they said no.
    const ack = acknowledgementValue(field);
    if (ack) {
      const standing = bank.get(ACKNOWLEDGEMENT_KEY);
      // An answer to this exact question that did not tick it (above) beats the standing permission: ask again.
      if (!own && standing && /^yes$/i.test(standing.answer.trim()) && push(ACKNOWLEDGEMENT_KEY, ack, standing.source)) continue;
      if (!standing) {
        if (!pending.some((q) => q.key === ACKNOWLEDGEMENT_KEY)) {
          pending.push({ key: ACKNOWLEDGEMENT_KEY, label: ACKNOWLEDGEMENT_QUESTION, type: "select", options: ["Yes", "No"], required: true });
        }
        continue;
      }
      ask(questionKey);
      continue;
    }

    if (!key) {
      ask(questionKey);
      continue;
    }
    const def = getAnswerKey(key);
    const eeo = def?.policy === "default_only" && def.default === rules.eeo_default;
    // Facts the profile holds (city, phone, links...) come from the profile the user confirmed, not from an older saved
    // answer: a "City = Greater Delhi Area" saved on 8 Oct had kept beating the profile's Bangalore (10 Oct dry run).
    const fromProfileFirst = def?.policy === "deterministic" ? profileValue(profile, key) : null;
    if (fromProfileFirst && push(key, fromProfileFirst, "resume")) continue;
    const saved = bank.get(key);
    if (saved) {
      if (push(key, saved.answer, saved.source, eeo)) continue;
      ask(questionKey);
      continue;
    }
    const fromProfile = profileValue(profile, key);
    if (fromProfile) {
      if (push(key, fromProfile, "resume")) continue;
      ask(questionKey);
      continue;
    }
    if (def?.default) {
      if (push(key, def.default, "default", eeo)) continue;
      ask(questionKey);
      continue;
    }
    if (def?.policy === "default_only") {
      if (push(key, rules.eeo_default, "default", true)) continue;
      ask(questionKey);
      continue;
    }
    ask(key);
  }

  return { values, pending, unfit };
}
