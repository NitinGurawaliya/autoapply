export type AnswerPolicy = "deterministic" | "bank_or_ask" | "ai_draft_ok" | "default_only";

export type AnswerFieldType = "text" | "number" | "select" | "multi" | "long_text" | "file";

export type AnswerKeyDef = {
  key: string;
  type: AnswerFieldType;
  synonyms: RegExp[];
  default?: string;
  policy: AnswerPolicy;
};

const EEO_DEFAULT = "Decline to answer";

export const ANSWER_KEYS: AnswerKeyDef[] = [
  { key: "first_name", type: "text", policy: "deterministic", synonyms: [/first\s*name/i, /given\s*name/i] },
  { key: "last_name", type: "text", policy: "deterministic", synonyms: [/last\s*name/i, /surname/i, /family\s*name/i] },
  { key: "full_name", type: "text", policy: "deterministic", synonyms: [/full\s*name/i, /^name$/i] },
  { key: "email", type: "text", policy: "deterministic", synonyms: [/e-?mail/i] },
  { key: "phone", type: "text", policy: "deterministic", synonyms: [/phone/i, /mobile/i] },
  { key: "city", type: "text", policy: "deterministic", synonyms: [/\bcity\b/i] },
  { key: "country", type: "text", policy: "deterministic", synonyms: [/\bcountry\b/i] },
  { key: "linkedin", type: "text", policy: "deterministic", synonyms: [/linkedin/i] },
  { key: "github", type: "text", policy: "deterministic", synonyms: [/github/i] },
  { key: "portfolio", type: "text", policy: "deterministic", synonyms: [/portfolio/i, /personal\s*(website|site)/i, /\bwebsite\b/i] },
  { key: "resume", type: "file", policy: "deterministic", synonyms: [/resume/i, /\bcv\b/i] },

  { key: "years_experience", type: "number", policy: "deterministic", synonyms: [/years?\s*(of\s*)?experience/i] },
  { key: "current_title", type: "text", policy: "deterministic", synonyms: [/current\s*title/i, /job\s*title/i] },
  { key: "current_company", type: "text", policy: "deterministic", synonyms: [/current\s*(company|employer)/i] },
  { key: "employment_type", type: "select", policy: "bank_or_ask", synonyms: [/employment\s*type/i] },
  { key: "start_date", type: "text", policy: "deterministic", synonyms: [/start\s*date/i, /available\s*(from|to\s*start)/i] },
  { key: "preferred_location", type: "multi", policy: "bank_or_ask", synonyms: [/preferred\s*location/i, /preferred\s*countr/i] },

  { key: "current_ctc", type: "text", policy: "bank_or_ask", synonyms: [/current\s*ctc/i, /current\s*salary/i, /present\s*ctc/i] },
  { key: "expected_ctc", type: "text", policy: "bank_or_ask", synonyms: [/expected\s*ctc/i, /expected\s*salary/i, /desired\s*(ctc|salary)/i] },
  { key: "salary_expectation", type: "text", policy: "bank_or_ask", synonyms: [/salary\s*expectation/i] },
  { key: "notice_period", type: "number", policy: "bank_or_ask", synonyms: [/notice\s*period/i] },
  { key: "work_authorization", type: "select", policy: "bank_or_ask", synonyms: [/work\s*authorization/i, /legally\s*authorized/i, /authori[sz]ed\s*to\s*work/i] },
  { key: "needs_sponsorship", type: "select", policy: "bank_or_ask", synonyms: [/sponsorship/i] },
  { key: "willing_to_relocate", type: "select", policy: "bank_or_ask", synonyms: [/relocat/i] },
  // Standing permission to tick required privacy / truthfulness / arbitration acknowledgements (modules/apply/acknowledgement.ts).
  // No synonyms: it is never a form label, only asked once and read by the resolver.
  { key: "accept_acknowledgements", type: "select", policy: "bank_or_ask", synonyms: [] },

  { key: "gender", type: "select", policy: "default_only", default: EEO_DEFAULT, synonyms: [/\bgender\b/i] },
  { key: "race", type: "select", policy: "default_only", default: EEO_DEFAULT, synonyms: [/\brace\b/i] },
  { key: "ethnicity", type: "select", policy: "default_only", default: EEO_DEFAULT, synonyms: [/ethnicit/i] },
  { key: "veteran_status", type: "select", policy: "default_only", default: EEO_DEFAULT, synonyms: [/veteran/i] },
  { key: "disability", type: "select", policy: "default_only", default: EEO_DEFAULT, synonyms: [/disabilit/i] },
  { key: "pronouns", type: "select", policy: "default_only", default: EEO_DEFAULT, synonyms: [/pronouns/i] },

  { key: "how_heard", type: "text", policy: "default_only", default: "Job board", synonyms: [/how\s*did\s*you\s*hear/i, /how\s*did\s*you\s*find/i] },
  { key: "cover_letter", type: "long_text", policy: "ai_draft_ok", synonyms: [/cover\s*letter/i] },
  { key: "free_text", type: "long_text", policy: "ai_draft_ok", synonyms: [/additional\s*information/i, /anything\s*else/i] },
  // Essay drafts (modules/apply/essay.ts): the one-time permission, and the "best project" story drafted once and reused.
  { key: "accept_ai_essays", type: "select", policy: "bank_or_ask", synonyms: [] },
  { key: "essay_best_project", type: "long_text", policy: "ai_draft_ok", synonyms: [] },
  // One answer for visa sponsorship everywhere outside the home country (modules/apply/sponsorship.ts). The user's own.
  { key: "sponsorship_outside_home", type: "select", policy: "bank_or_ask", synonyms: [] },
];

const BY_KEY = new Map(ANSWER_KEYS.map((def) => [def.key, def]));

export function getAnswerKey(key: string) {
  return BY_KEY.get(key) ?? null;
}
