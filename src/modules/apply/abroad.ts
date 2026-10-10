import type { ConceptId } from "@/modules/answers";
import type { PendingQuestion } from "./adapter";
import { asksYesNo } from "./derive";
import { countryCode, outsideHomeCountry, placesNamed } from "./places";
import { SPONSORSHIP_ABROAD_KEY, SPONSORSHIP_ABROAD_OPTIONS, sponsorshipAbroadQuestion, standingSponsorship } from "./sponsorship";

/**
 * Questions about working in another country ("Are you able to come into our London office 3x a week?", "Are you
 * legally authorized to work in the United States?", "Is your country of citizenship one of: Cuba, Iran...?"),
 * answered from a few standing answers the user gives once, never guessed:
 * - "Are you open to moving abroad for a job?" (`relocate_outside_home`): No → No to relocating to, working on site
 *   in or commuting to an office in another country. Yes or "It depends" keeps the per-job question.
 * - the sponsorship answer (sponsorship.ts): needing sponsorship everywhere outside home → not authorized to work there.
 * - "Which country are you a citizen of?" (`citizenship`): settles "is your citizenship one of these countries" and,
 *   for a citizen living in their own country, "is your permanent residency one of these" and "are you authorized to
 *   work in the country you reside in" (Yes).
 * Only for places outside the candidate's home country (places.ts); a question about home is left as it was.
 */

export const RELOCATE_ABROAD_KEY = "relocate_outside_home";
export const RELOCATE_ABROAD_OPTIONS = ["No, only jobs where I live", "Yes", "It depends on the job"];
export const relocateAbroadQuestion = (home: string) => `Are you open to moving out of ${home} for a job (relocating, or working on site in another country)?`;

export const CITIZENSHIP_KEY = "citizenship";
export const CITIZENSHIP_QUESTION = "Which country are you a citizen of? (If more than one, list them separated by commas.)";

type Row = { answer: string; source: string } | undefined;
type Found = { answer: string; basis: string; source: string } | { ask: PendingQuestion } | null;

// Regular presence: relocating, on site, hybrid, N days a week, commuting. Not a few trips a year, and not questions
// about relocation assistance, packages or stipends (a different fact).
const REGULAR_PRESENCE = /relocat|on-?site|in[- ]office|in[- ]person|hybrid|commut|travel (in)?to (our|the)|come (in)?to (our|the)|work (from|out of|at) (our|the)|based (in|at|out of)|(\d|one|two|three|four|five)\s*(x|times|days?)\s*(a|per|each)\s*week|days (a|per) week|full[- ]time (in|at|from)|every day/i;
const NOT_PRESENCE = /assistance|package|stipend|support|reimburs|times (a|per) year|per year|annual|offsite|off-site|events?\b|conference/i;
const DEMONYMS: Record<string, string> = { indian: "IN", american: "US", british: "UK", canadian: "CA", german: "DE", french: "FR", irish: "IE", australian: "AU", singaporean: "SG", chinese: "CN", japanese: "JP", brazilian: "BR", mexican: "MX", "sri lankan": "LK", pakistani: "PK", bangladeshi: "BD", nepali: "NP", russian: "RU", ukrainian: "UA" };

/** The citizenship answer as country codes ("Indian", "India, Canada"); null when any part is not a country we know. */
export function citizenshipCodes(answer: string | undefined) {
  const parts = (answer ?? "").split(/,|\band\b|\//i).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const codes = parts.map((part) => countryCode(part) ?? DEMONYMS[part.toLowerCase()] ?? null);
  return codes.every((code): code is string => !!code) ? new Set(codes) : null;
}

const yesNo = (options: string[] | undefined) => !options?.length || (options.some((o) => /^yes\b/i.test(o.trim())) && options.some((o) => /^no\b/i.test(o.trim())));

export function abroadAnswer(input: {
  kind: Exclude<ConceptId, "general">;
  label: string;
  options?: string[];
  required: boolean;
  profile: { country: string | null; city: string | null };
  jobCountry: string | null | undefined;
  bank: (key: string) => Row;
}): Found {
  const { kind, label, profile, bank } = input;
  const home = profile.country;
  if (!home || !countryCode(home)) return null;
  const where = profile.city ? `${profile.city}, ${home}` : home;
  const ask = (question: PendingQuestion): Found => (input.required ? { ask: question } : null);

  if (kind === "willing_to_relocate" || kind === "office_attendance") {
    if (!REGULAR_PRESENCE.test(label) || NOT_PRESENCE.test(label) || !yesNo(input.options)) return null;
    if (outsideHomeCountry(label, home, input.jobCountry) !== true) return null;
    const standing = bank(RELOCATE_ABROAD_KEY);
    if (!standing) return ask({ key: RELOCATE_ABROAD_KEY, label: relocateAbroadQuestion(home), type: "select", options: RELOCATE_ABROAD_OPTIONS, required: true });
    if (!/^no\b/i.test(standing.answer.trim())) return null;
    return { answer: "No", basis: `your answer: you are not moving out of ${home} (you live in ${where})`, source: standing.source };
  }

  if (kind === "work_authorization") {
    if (!yesNo(input.options) || /\b(not|without)\b.{0,20}\bsponsor/i.test(label)) return null;
    // "Are you legally authorized to work in the country you reside?": a citizen of the country they live in is.
    if (/country (where |in which |that )?you (currently )?(reside|live|are based|are located)|your (current )?country of residence/i.test(label)) {
      const standing = bank(CITIZENSHIP_KEY);
      if (!standing) return ask({ key: CITIZENSHIP_KEY, label: CITIZENSHIP_QUESTION, type: "text", required: true });
      if (!citizenshipCodes(standing.answer)?.has(countryCode(home)!)) return null;
      return { answer: "Yes", basis: `your answer: you are a citizen of ${standing.answer} and live in ${where}`, source: "derived" };
    }
    if (outsideHomeCountry(label, home, input.jobCountry) !== true) return null;
    const standing = bank(SPONSORSHIP_ABROAD_KEY);
    if (!standing) return ask({ key: SPONSORSHIP_ABROAD_KEY, label: sponsorshipAbroadQuestion(home), type: "select", options: SPONSORSHIP_ABROAD_OPTIONS, required: true });
    if (standingSponsorship(standing.answer) !== "Yes") return null;
    return { answer: "No", basis: `your answer: you need visa sponsorship to work outside ${home}, so you are not yet authorized to work there`, source: "derived" };
  }

  if (kind === "citizenship") {
    // "Is your (most recent) country of citizenship one of: Cuba, Iran...?", "Are you a citizen of Canada?". A "U.S.
    // person" (citizen, permanent or temporary resident) and green-card questions are not settled by citizenship alone.
    if (!asksYesNo(label) || !yesNo(input.options) || /u\.?\s?s\.? person|green card|temporary resident/i.test(label)) return null;
    const { codes } = placesNamed(label);
    if (codes.size === 0) return null;
    const standing = bank(CITIZENSHIP_KEY);
    if (!standing) return ask({ key: CITIZENSHIP_KEY, label: CITIZENSHIP_QUESTION, type: "text", required: true });
    const mine = citizenshipCodes(standing.answer);
    if (!mine) return null;
    const homeCode = countryCode(home)!;
    const asksResidency = /resident|residency|reside/i.test(label);
    const asksCitizenship = /citizen|nationality/i.test(label);
    if (asksCitizenship && [...mine].some((code) => codes.has(code))) return { answer: "Yes", basis: `your answer: you are a citizen of ${standing.answer}`, source: standing.source };
    // Permanent residency: settled only for a citizen of the country they live in (their residency is that country).
    if (asksResidency && (!mine.has(homeCode) || codes.has(homeCode))) return null;
    return { answer: "No", basis: `your answer: you are a citizen of ${standing.answer}${asksResidency ? `, living in ${where}` : ""}`, source: standing.source };
  }
  return null;
}
