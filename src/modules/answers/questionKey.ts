import { createHash } from "node:crypto";
import { ANSWER_KEYS } from "./keys";

// Sensitive questions often mention an identity word ("authorized to work in the country where the job is located"),
// so they are matched first: a work-authorization question must never be read as the candidate's country.
const SENSITIVE_FIRST = new Set(["current_ctc", "expected_ctc", "salary_expectation", "notice_period", "work_authorization", "needs_sponsorship", "willing_to_relocate"]);
const MATCH_ORDER = [...ANSWER_KEYS.filter((def) => SENSITIVE_FIRST.has(def.key)), ...ANSWER_KEYS.filter((def) => !SENSITIVE_FIRST.has(def.key))];

export function matchKeyBySynonym(label: string): string | null {
  const text = label.trim();
  for (const def of MATCH_ORDER) {
    if (def.synonyms.some((pattern) => pattern.test(text))) return def.key;
  }
  return null;
}

const CUSTOM_KEY = /^q_[a-f0-9]{12}$/;

/** Stable key for a job-specific question no canonical key covers; its answer is reused whenever the same label appears. */
export function customQuestionKey(label: string) {
  const normalized = label.replace(/\s+/g, " ").trim().toLowerCase();
  return `q_${createHash("sha256").update(normalized).digest("hex").slice(0, 12)}`;
}

export function isCustomQuestionKey(key: string) {
  return CUSTOM_KEY.test(key);
}

/** Pending-question key for a one-time code an ATS emails mid-submit. Never stored in the answer bank. */
export const ONE_TIME_CODE_KEY = "security_code";
