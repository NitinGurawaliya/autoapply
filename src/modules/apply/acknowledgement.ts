import type { FormField } from "./adapter";

/**
 * Required acknowledgements and routine consents that gate an application: privacy notices and data processing,
 * "my answers are true" certifications and declarations, arbitration agreements, interviews being recorded and
 * transcribed, the company's AI policy for interviews. They are not facts about the candidate, so with the
 * candidate's standing permission (answer key `accept_acknowledgements` = Yes) every adapter accepts them; without it
 * each one is asked (owner, 1 Nov: the obvious consent questions go through on their own).
 */
export const ACKNOWLEDGEMENT_KEY = "accept_acknowledgements";
export const ACKNOWLEDGEMENT_QUESTION =
  "Forms often require you to accept a privacy notice, a \"my answers are true\" declaration, an arbitration agreement or interviews being recorded before they accept an application. May SwipeApply accept these for you on every form? (Marketing opt-ins and questions about you, such as work authorization, are always asked.)";

const ACKNOWLEDGE =
  /acknowledg|privacy (policy|notice|statement)|candidate privacy|data (protection|processing)|personal (data|information)|\bgdpr\b|\bconsent\b|i (have )?read|read and (agree|understood|understand)|\bi understand\b|i agree|agree to|terms (and|&) conditions|\bcertify\b|\bcertification\b|\battest\b|arbitration|true and (correct|complete|accurate)|accurate and complete|not knowingly withheld|\b(hereby )?declare\b|\bdeclaration\b|to the best of my knowledge|interview recording|record(ed|ing)? (and|&) transcrib|\btranscrib(e|ed|ing)\b.*\binterview|\binterviews?\b.*\b(recorded|recording|transcribed)\b|note.?taker|\bai (policy|usage policy|use policy)\b/i;

// Opt-ins are a real choice, and these are claims about the candidate dressed as a certification: never auto-ticked.
const NOT_ACKNOWLEDGEMENT =
  /opt.?in|newsletter|marketing|\bsms\b|text message|whatsapp|talent (community|pool|network)|future (opportunities|roles|openings|positions)|keep (me|my)|contact me about|authori[sz]ed to work|sponsor|visa|citizen|u\.?s\.? person|veteran|disabilit|gender|\brace\b|ethnic|criminal|convict|felony|18 years|over 18|years of age|relocat|salary|compensation|notice period|employed by|worked (at|for)|non-?compete|background check/i;

// The option that means "I acknowledge" when the question is a choice rather than a single box.
const AFFIRMATIVE = /^(yes\b|i (hereby )?(agree|acknowledge|accept|confirm|certify|declare|consent|have read|understand)|i give (my )?consent|give consent\b|consent(ed)?\b|acknowledged?\b|agreed?\b|accept(ed)?\b|confirm(ed)?\b)/i;

const CHOICE_TYPES = new Set(["select", "radio", "yesno", "combobox", "checkbox-group"]);

/**
 * The value that ticks this field if it is a required acknowledgement, else null.
 * One box, a group with exactly one box, or a choice with one affirmative option.
 */
export function acknowledgementValue(field: Pick<FormField, "label" | "type" | "required" | "options">): string | null {
  if (!field.required) return null;
  const options = field.options ?? [];
  const text = `${field.label} ${options.length === 1 ? options[0] : ""}`;
  if (!ACKNOWLEDGE.test(text) || NOT_ACKNOWLEDGEMENT.test(text)) return null;
  if (field.type === "checkbox") return "Yes";
  if (field.type === "checkbox-group" && options.length === 1) return options[0];
  if (CHOICE_TYPES.has(field.type)) {
    const yes = options.filter((option) => AFFIRMATIVE.test(option.trim()));
    return yes.length === 1 ? yes[0] : null;
  }
  return null;
}
