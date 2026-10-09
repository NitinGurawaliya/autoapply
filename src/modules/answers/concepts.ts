/**
 * The few kinds of question where reusing an answer from another form is dangerous. Everything else is "general": if
 * two questions ask for the same fact (how you heard about us, your zip code), one answer serves both. These need more:
 * - a PARAMETER (the country, company or place the question is about) that must be the same for both questions;
 * - an answer the user gave themselves (never one from the resume or a default).
 * Used by the verify step (modules/apply/recall.ts). The detectors are a deterministic safety net: when one fires, the
 * question is treated as that kind even if the AI called it general.
 */

export const CONCEPT_IDS = [
  "general",
  "residence",
  "citizenship",
  "work_authorization",
  "needs_sponsorship",
  "willing_to_relocate",
  "office_attendance",
  "previously_employed_by",
  "company_relationship",
  "compensation",
  "notice_period",
  "eeo",
] as const;

export type ConceptId = (typeof CONCEPT_IDS)[number];

type Parameter = "country" | "place" | "company";

export const RISKY: Record<Exclude<ConceptId, "general">, { parameter: Parameter | null; detector: RegExp }> = {
  // Citizenship / permanent residence ("U.S. person", green card) is not the same fact as being allowed to work.
  citizenship: { parameter: "country", detector: /u\.?s\.? person|\bcitizen|citizenship|permanent resident|green card|nationality/i },
  work_authorization: { parameter: "country", detector: /authori[sz]ed\b.{0,30}\bwork|(legally|lawfully|eligible|permitted|allowed) to work|right to work|work permit/i },
  residence: { parameter: "place", detector: /\breside\b|\bresiding\b|\bresident of\b|currently (live|living|located|based)|where do you (live|reside)|located in the|live in the|based in the/i },
  needs_sponsorship: { parameter: "country", detector: /sponsor|\bvisa\b/i },
  willing_to_relocate: { parameter: "place", detector: /relocat/i },
  office_attendance: { parameter: "place", detector: /\boffice\b|on-?site|in[- ]person|days (a|per) week|hybrid/i },
  previously_employed_by: { parameter: "company", detector: /(worked|employed|contracted|interned)\b.{0,40}\b(at|for|by|with)\b|former employee|previous(ly)? (worked|employed)/i },
  company_relationship: { parameter: "company", detector: /relative|family member|know (anyone|someone)|friends? (at|who)|personal relationship|conflict of interest|outside business/i },
  compensation: { parameter: null, detector: /salary|\bctc\b|compensation|expected pay|pay expectation/i },
  notice_period: { parameter: null, detector: /notice period/i },
  eeo: { parameter: null, detector: /gender|\brace\b|ethnic|veteran|disabilit|pronoun|hispanic|latin[oax]|sexual orientation|transgender/i },
};

/** The risky kind a question's own words reveal, or null for general. */
export function detectConcept(question: string): Exclude<ConceptId, "general"> | null {
  for (const [id, def] of Object.entries(RISKY) as Array<[Exclude<ConceptId, "general">, (typeof RISKY)[keyof typeof RISKY]]>) {
    if (def.detector.test(question)) return id;
  }
  return null;
}

const COUNTRY_ALIASES: Record<string, string> = {
  "united states": "us", "united states of america": "us", usa: "us", "u s": "us", "u s a": "us", america: "us",
  "united kingdom": "uk", "great britain": "uk", britain: "uk", england: "uk", "u k": "uk",
  india: "in", bharat: "in",
};

/** Lower-case words only, countries folded to one code ("United States", "USA", "US" → "us"). */
export function normalizeParam(value: string | null | undefined) {
  if (!value) return null;
  const words = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!words) return null;
  return COUNTRY_ALIASES[words] ?? words;
}

const wordsOf = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** True when the parameter is actually written in one of these texts (the question, the job, the saved answer's job):
 *  the AI may only name a country, company or place it can point to, never one it guessed. */
export function grounded(param: string, texts: Array<string | null | undefined>) {
  const target = normalizeParam(param);
  if (!target) return false;
  const spellings = [target, ...Object.entries(COUNTRY_ALIASES).filter(([, code]) => code === target).map(([name]) => name)];
  return texts.some((text) => text && spellings.some((spelling) => wordsOf(text).includes(` ${spelling} `)));
}

/** Same parameter: equal after normalising, or one place contains the other ("london" vs "london uk"). */
export function sameParam(a: string | null | undefined, b: string | null | undefined) {
  const x = normalizeParam(a);
  const y = normalizeParam(b);
  if (!x || !y) return false;
  return x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `);
}
