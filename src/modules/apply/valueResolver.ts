import { customQuestionKey, getAnswerKey, matchKeyBySynonym } from "@/modules/answers";
import { loadRules } from "@/modules/governance";
import type { FormField, PendingQuestion, ResolvedValue } from "./adapter";

type AnswerRow = { key: string; answer: string; source: string };

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

/** "1" against ["0-2", "3-5", "10+"] → "0-2". Only when the value is a plain number and exactly one range holds it. */
function numericRange(value: string, options: string[]) {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) return null;
  const n = Number(value);
  const hits = options.filter((option) => {
    const between = option.match(/^\s*(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(years?)?\s*$/i);
    if (between) return n >= Number(between[1]) && n <= Number(between[2]);
    const plus = option.match(/^\s*(\d+(?:\.\d+)?)\s*\+\s*(years?)?\s*$/i);
    return plus ? n >= Number(plus[1]) : false;
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

export function resolveValues(
  mapped: Array<{ field: FormField; key: string | null }>,
  profile: ProfileFacts,
  answers: AnswerRow[],
) {
  const rules = loadRules();
  const bank = new Map(answers.map((row) => [row.key, row]));
  const values: ResolvedValue[] = [];
  const pending: PendingQuestion[] = [];

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
      const value = field.type === "file" ? raw : field.type === "number" ? fitNumber(raw) : fitOption(raw, field.options, eeo);
      if (value == null) return false;
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

    // The user's answer to this exact question beats anything inferred from a canonical key.
    const own = bank.get(questionKey);
    if (own && push(key ?? questionKey, own.answer, own.source)) continue;

    if (!key) {
      ask(questionKey);
      continue;
    }
    const def = getAnswerKey(key);
    const eeo = def?.policy === "default_only" && def.default === rules.eeo_default;
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

  return { values, pending };
}
