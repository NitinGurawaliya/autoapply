import { monthIndex } from "./derive";

/**
 * Greenhouse's work-history and education sections (`company-name-0`, `title-0`, `start-date-month-0`,
 * `start-date-year-0`, `end-date-month-0`, `end-date-year-0`, `current-role-0_1`, `school--0`, `degree--0`,
 * `discipline--0`), filled from the resume's most recent role and degree, by the field's id. Before this they were
 * asked (Coinbase: 17 questions) or mis-mapped ("Start date year" got the availability answer and failed on a number
 * box). Only what the resume states; anything it does not is left for the normal chain (asked).
 */

type Role = { title?: unknown; company?: unknown; start?: unknown; end?: unknown };
type Degree = { school?: unknown; degree?: unknown; year?: unknown };
export type HistoryProfile = { experience?: unknown; education?: unknown };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const isCurrent = (value: string | null) => !!value && /^(present|current|now|till date|to date|ongoing)$/i.test(value);

/** Month name and year of a resume date ("June 2025", "2023-01", "2020"); the month only when the resume gives one. */
function dateParts(value: string | null) {
  if (!value || isCurrent(value)) return null;
  const index = monthIndex(value);
  if (index === null) return null;
  const hasMonth = !/^\d{4}$/.test(value.trim());
  return { month: hasMonth ? MONTHS[index % 12] : null, year: String(Math.floor(index / 12)) };
}

/** "B.Tech in Information Technology", "Bachelor of Technology - Computer Science", "B.Tech, CS" → the subject. */
export function disciplineOf(degree: string | null) {
  if (!degree) return null;
  const match = degree.match(/\s(?:in|of)\s+(?!technology\b|engineering\b|science\b|arts\b|commerce\b)(.+)$/i) ?? degree.match(/\s*[-–,:]\s*(.+)$/) ?? degree.match(/^(?:b\.?\s?tech|m\.?\s?tech|b\.?e\.?|m\.?e\.?|b\.?sc|m\.?sc|bca|mca|b\.?s\.?|m\.?s\.?)\.?\s+(.+)$/i);
  const subject = match?.[1]?.replace(/^(in|of)\s+/i, "").trim();
  return subject && subject.length > 1 ? subject : null;
}

/** "2022 – 2026", "2026", "May 2026" → start and end years of a degree. */
function degreeYears(value: string | null) {
  const years = (value ?? "").match(/\b(19|20)\d{2}\b/g) ?? [];
  if (years.length === 0) return null;
  return { start: years.length > 1 ? years[0] : null, end: years[years.length - 1] };
}

/** The value for a history field, with what it rests on, or null when it is not one or the resume does not say. */
export function historyValue(selector: string, profile: HistoryProfile): { value: string; basis: string } | null {
  const id = selector.match(/\[id="([^"]+)"\]/)?.[1] ?? selector.replace(/^#/, "");
  const role = Array.isArray(profile.experience) ? (profile.experience as Role[]).find((item) => item && (str(item.title) || str(item.company))) : undefined;
  const degree = Array.isArray(profile.education) ? (profile.education as Degree[]).find((item) => item && (str(item.school) || str(item.degree))) : undefined;
  const roleName = role ? `${str(role.title) ?? ""} at ${str(role.company) ?? ""}`.trim() : "";
  const fromRole = (value: string | null) => (value ? { value, basis: `from your resume: ${roleName}` } : null);
  const fromDegree = (value: string | null) => (value ? { value, basis: `from your resume: ${str(degree?.degree) ?? ""}, ${str(degree?.school) ?? ""}` } : null);

  if (/^company-name-0$/.test(id)) return fromRole(str(role?.company));
  if (/^title-0$/.test(id)) return fromRole(str(role?.title));
  if (/^(start|end)-date-(month|year)-0$/.test(id)) {
    const [, which, part] = id.match(/^(start|end)-date-(month|year)-0$/)!;
    const parts = dateParts(str(which === "start" ? role?.start : role?.end));
    return fromRole(parts ? (part === "month" ? parts.month : parts.year) : null);
  }
  if (/^current-role-0(_\d+)?$/.test(id)) return role && isCurrent(str(role.end)) ? fromRole("Yes") : null;
  if (/^school--0$/.test(id)) return fromDegree(str(degree?.school));
  if (/^degree--0$/.test(id)) return fromDegree(str(degree?.degree));
  if (/^discipline--0$/.test(id)) return fromDegree(disciplineOf(str(degree?.degree)));
  if (/^(start|end)-(year|date-year)--0$/.test(id)) {
    const years = degreeYears(str(degree?.year));
    return fromDegree(id.startsWith("start") ? years?.start ?? null : years?.end ?? null);
  }
  return null;
}
