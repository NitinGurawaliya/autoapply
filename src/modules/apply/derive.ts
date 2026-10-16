import { z } from "zod";
import { callJson } from "@/lib/llm";
import { detectConcept } from "@/modules/answers";
import type { FormField } from "./adapter";
import { countryCode, has, placesNamed, words } from "./places";
import type { MemoryAnswer } from "./recall";

/**
 * Answers worked out from what the profile and resume already prove (T54), each with the evidence it rests on:
 * - residence: "Do you reside in the US or Canada?", "Please confirm you're based in BC or Ontario", "Are you located in
 *   Belarus, Cuba, Iran...?" from the profile's country (places.ts);
 * - time zone: "What timezone do you reside in?" from the profile's country (India only: one time zone);
 * - worked at a named company: from the resume's employers;
 * - "N years of experience in X": "No" when total experience is under N, "Yes" when the resume's dated roles that
 *   involve X add up to N years (the model may only say WHICH existing roles involve X; the arithmetic is code).
 * Anything not clearly settled by the evidence is left for the user. Never used for pay, notice period, work
 * authorization, sponsorship or EEO questions (they are not derivable from a resume).
 */

type Role = { title: string; company: string; start: string | null; end: string | null; summary: string | null };
export type ProfileForDerive = {
  country: string | null;
  city: string | null;
  yearsExperience: number | null;
  currentCompany: string | null;
  skills: unknown;
  experience: unknown;
  education?: unknown;
};

type School = { school?: string | null; degree?: string | null; year?: string | null };

/** "Education History" (free text) → the resume's education, one line per school (16 Oct, Tekion). */
function educationHistory(label: string, type: string, profile: ProfileForDerive): { answer: string; basis: string } | null {
  const schools = Array.isArray(profile.education) ? (profile.education as School[]).filter((item) => item?.school) : [];
  if (schools.length === 0) return null;
  // A school picker (search list) takes the school's name: "Education History", "What university do you attend?".
  if (type === "combobox" && /\b(education|school|college|university|institution|alma mater)\b/i.test(label)) {
    return { answer: schools[0].school!, basis: "from your resume's education" };
  }
  if (type !== "text" && type !== "textarea") return null;
  if (!/^\s*(your )?(education(al)?( history| background| details| qualifications?)?|academic (history|background|qualifications?)|list your (education|degrees?|qualifications?))\s*[?:*]?\s*$/i.test(label)) return null;
  const lines = schools.map((item) => [item.degree, item.school].filter(Boolean).join(", ") + (item.year ? ` (${item.year})` : ""));
  return { answer: lines.join("\n"), basis: "from your resume's education" };
}

/**
 * "If you have worked as a contractor or consultant for Tekion, give the dates and agency" → "Not applicable" when the
 * company is not among the resume's employers; asked when it is (16 Oct).
 */
function contractedFor(label: string, type: string, roles: Role[]): { answer: string; basis: string } | null {
  if ((type !== "text" && type !== "textarea") || asksYesNo(label)) return null;
  if (!/\bif you\b/i.test(label) || !/\b(provide|list|share|give|include)\b/i.test(label)) return null;
  const company = label.match(/\b(?:contractor|consultant|employee|intern)s?\b(?: or (?:contractor|consultant|employee|intern))?\s+(?:for|at|with)\s+([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,2})/)?.[1]?.trim();
  if (!company || roles.length === 0) return null;
  const target = normalCompany(company);
  const employers = roles.map((role) => role.company).filter(Boolean);
  if (!target || employers.some((employer) => ` ${normalCompany(employer)} `.includes(` ${target} `) || ` ${target} `.includes(` ${normalCompany(employer)} `))) return null;
  return { answer: "Not applicable", basis: `derived from your resume: ${company} is not among your employers (${employers.join(", ")})` };
}

/** Whether an answer says yes or no ("Yes, I am eligible", "I have never been employed by..."), or null. */
export function yesNoOf(text: string): "yes" | "no" | null {
  if (/^\s*i (have|am|do|will|was) (never|not)\b/i.test(text)) return "no";
  if (/^\s*(yes|i am|i have|i do|i will|true)\b/i.test(text)) return "yes";
  if (/^\s*(no|i am not|i do not|i don.t|i will not|false|none)\b/i.test(text)) return "no";
  return null;
}

// Leading tags such as "[Relocation]" do not change what is asked.
const opening = (question: string) => question.replace(/^\s*\[[^\]]*\]\s*/, "").trim();
// A yes/no question, also when it opens with a statement and asks at the end ("... let us know if you're residing in X?").
// Also a request to confirm ("Please confirm you're based in BC or Ontario").
export const asksYesNo = (question: string) =>
  /^(are|do|does|did|have|has|had|is|was|were|will|would|can|could)\b/i.test(opening(question)) ||
  /\b(if|whether) (you|you're|you are)\b[^.]*\?\s*$/i.test(question) ||
  /\bconfirm (that )?(you|you're|you are)\b/i.test(question);

/** "Do you reside in the US or Canada?" → "No" for a profile in India. */
function residence(label: string, profile: ProfileForDerive): { answer: string; basis: string } | null {
  if (!asksYesNo(label) || /relocat|willing|commut|visa|authori/i.test(label)) return null;
  if (!/\b(reside|residing|resident|live|living|located|based)\b/i.test(label)) return null;
  const home = countryCode(profile.country);
  if (!home) return null;
  const { codes: named, inside } = placesNamed(label);
  if (named.size === 0) return null;
  const where = profile.city ? `${profile.city}, ${profile.country}` : `${profile.country}`;
  if (!named.has(home)) return { answer: "No", basis: `derived from your location: ${where}` };
  // In the right country but asked about a smaller place in it: the country alone does not settle it.
  if (inside.has(home)) return null;
  return { answer: "Yes", basis: `derived from your location: ${where}` };
}

/** "Please select the country where you currently reside." → the profile's country (the form's option is matched later). */
function residenceCountry(label: string, profile: ProfileForDerive): { answer: string; basis: string } | null {
  if (asksYesNo(label) || !profile.country) return null;
  if (!/\b(which|what|select|choose|name|enter)\b.{0,40}\bcountry\b.{0,40}\b(reside|residing|live|living|located|based|residence)\b|\bcountry of (current )?residence\b/i.test(label)) return null;
  return { answer: profile.country, basis: `derived from your location: ${profile.city ? `${profile.city}, ` : ""}${profile.country}` };
}

/** "Where are you currently located?" (asked as free text) → the profile's city and country. */
function currentLocation(label: string, profile: ProfileForDerive): { answer: string; basis: string } | null {
  if (asksYesNo(label) || !profile.country) return null;
  if (!/^\s*(where are you (currently )?(located|based|living)|where do you (currently )?(live|reside)|what is your (current )?(location|city)|(your )?current (location|city))\b/i.test(label)) return null;
  const place = profile.city ? `${profile.city}, ${profile.country}` : profile.country;
  return { answer: place, basis: `derived from your location: ${place}` };
}

/** "What timezone do you reside in?" → India Standard Time for a profile in India (one time zone for the whole country). */
function timeZone(label: string, profile: ProfileForDerive): { answer: string; basis: string } | null {
  if (!/\btime ?zones?\b/i.test(label) || /\b(overlap|work (in|during|across)|willing|able|comfortable|flexib)/i.test(label)) return null;
  if (countryCode(profile.country) !== "IN") return null;
  const where = profile.city ? `${profile.city}, ${profile.country}` : `${profile.country}`;
  return { answer: "India Standard Time (IST, UTC+5:30)", basis: `derived from your location: ${where}` };
}

const normalCompany = (name: string) =>
  words(name)
    .replace(/ (inc|llc|ltd|limited|corp|corporation|co|company|technologies|technology|labs|pvt|private|plc|gmbh|or any of its subsidiaries|or a .* affiliate) /g, " ")
    .trim();

/** "Have you ever worked at MongoDB?" → "No" when MongoDB is not among the resume's employers. */
function workedAt(label: string, roles: Role[]): { answer: string; basis: string } | null {
  if (!asksYesNo(label) || detectConcept(label) !== "previously_employed_by" || roles.length === 0) return null;
  const match =
    label.match(/(?:worked|employed|interned|contracted)\b.{0,40}?\b(?:at|for|by|with)\s+([A-Z][\w&.'-]*(?:[ ,]+(?:[A-Z][\w&.'-]*|Inc\.?))*)/) ??
    // "Are you currently a Tekion employee?" (16 Oct)
    label.match(/\b(?:[Aa]re|[Ww]ere) you (?:currently |presently |ever )?(?:an? )?(?:current |former )?([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,2}) (?:employee|contractor)\b/);
  const company = match?.[1]?.trim();
  if (!company || /^(any|a|an|the)\b/i.test(company)) return null;
  const target = normalCompany(company);
  if (!target) return null;
  const employers = roles.map((role) => role.company).filter(Boolean);
  const hit = employers.find((employer) => {
    const e = normalCompany(employer);
    return e === target || ` ${e} `.includes(` ${target} `) || ` ${target} `.includes(` ${e} `);
  });
  // A past job there does not prove a current one: "currently" is asked when the company is among the employers.
  if (hit && /\b(currently|presently)\b/i.test(label)) return null;
  if (hit) return { answer: "Yes", basis: `derived from your resume: you worked at ${hit}` };
  return { answer: "No", basis: `derived from your resume: ${company.replace(/[,.]+$/, "")} is not among your employers (${employers.join(", ")})` };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Jan 2026", "June 2025", "2023-01", "01/2023", "2020" → months since year 0; "present" → now. */
export function monthIndex(value: string | null, now = new Date()): number | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (/^(present|current|now|till date|to date|ongoing)$/.test(text)) return now.getUTCFullYear() * 12 + now.getUTCMonth();
  const iso = text.match(/^(\d{4})-(\d{1,2})/);
  if (iso) return Number(iso[1]) * 12 + Number(iso[2]) - 1;
  const slash = text.match(/^(\d{1,2})\/(\d{4})$/);
  if (slash) return Number(slash[2]) * 12 + Number(slash[1]) - 1;
  const named = text.match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (named && MONTHS.includes(named[1])) return Number(named[2]) * 12 + MONTHS.indexOf(named[1]);
  const year = text.match(/^(\d{4})$/);
  if (year) return Number(year[1]) * 12;
  return null;
}

/** Total years covered by these roles, overlaps counted once; roles without usable dates are left out. */
export function yearsIn(roles: Role[], now = new Date()) {
  const spans = roles
    .map((role) => [monthIndex(role.start, now), monthIndex(role.end ?? null, now)] as const)
    .filter((span): span is readonly [number, number] => span[0] !== null && span[1] !== null && span[1] >= span[0])
    .map(([a, b]) => [a, b + 1] as const)
    .sort((x, y) => x[0] - y[0]);
  let months = 0;
  let reach = -Infinity;
  for (const [a, b] of spans) {
    if (b <= reach) continue;
    months += b - Math.max(a, reach);
    reach = b;
  }
  return months / 12;
}

const yearsQuestion = (label: string) => {
  const m = opening(label).match(/(\d+)\s*\+?\s*(?:or more\s+)?years?\s+(?:of\s+)?(?:professional\s+|hands-on\s+|relevant\s+|industry\s+|work\s+|full-time\s+)?experience\s+(?:in|with|as|using|of|on|developing)\s+(.+?)\??$/i);
  return m ? { years: Number(m[1]), subject: m[2].trim() } : null;
};

const pickSchema = z.object({ results: z.array(z.object({ index: z.number().int(), roles: z.array(z.number().int()) })) });

/** For each subject, which roles (by number) clearly involved it; only roles that exist are kept. */
async function rolesInvolving(subjects: string[], roles: Role[]): Promise<number[][]> {
  if (subjects.length === 0 || roles.length === 0) return subjects.map(() => []);
  const verdict = await callJson(
    pickSchema,
    `For each skill or role, list the numbers of the applicant's resume roles whose title or summary clearly show the applicant doing it or using it. Only list a role when the text says so; do not guess from the job title alone unless the title names it. Return {"results":[{"index","roles":[numbers]}]}.`,
    JSON.stringify({ subjects: subjects.map((subject, index) => ({ index, subject })), roles: roles.map((role, n) => ({ n, title: role.title, company: role.company, summary: (role.summary ?? "").slice(0, 1200) })) }),
  );
  return subjects.map((_, index) => (verdict.results.find((result) => result.index === index)?.roles ?? []).filter((n) => Number.isInteger(n) && n >= 0 && n < roles.length));
}

const describe = (role: Role) => `${role.title} at ${role.company} (${role.start ?? "?"} – ${role.end ?? "?"})`;

/** Derived answers for these fields, by label. */
export async function deriveAnswers(input: { profile: ProfileForDerive; fields: FormField[] }): Promise<Map<string, MemoryAnswer>> {
  const out = new Map<string, MemoryAnswer>();
  const roles = Array.isArray(input.profile.experience) ? (input.profile.experience as Role[]).filter((role) => role && (role.title || role.company)) : [];
  const yearsAsked: Array<{ label: string; years: number; subject: string }> = [];
  const put = (label: string, found: { answer: string; basis: string }) => out.set(label, { key: "", answer: found.answer, basis: found.basis, score: 1, source: "derived" });

  for (const field of input.fields) {
    const label = field.label;
    // Never pay, notice period, work authorization, sponsorship, relocation, office or EEO.
    const kind = detectConcept(label);
    if (kind && kind !== "residence" && kind !== "previously_employed_by") continue;
    const located = kind === "residence" || !kind ? currentLocation(label, input.profile) : null;
    if (located) {
      put(label, located);
      continue;
    }
    const homeCountry = kind === "residence" || !kind ? residenceCountry(label, input.profile) : null;
    if (homeCountry) {
      put(label, homeCountry);
      continue;
    }
    const zone = kind === "residence" || !kind ? timeZone(label, input.profile) : null;
    if (zone) {
      put(label, zone);
      continue;
    }
    const lived = kind === "residence" || !kind ? residence(label, input.profile) : null;
    if (lived) {
      put(label, lived);
      continue;
    }
    const worked = workedAt(label, roles) ?? contractedFor(label, field.type, roles);
    if (worked) {
      put(label, worked);
      continue;
    }
    const studied = !kind ? educationHistory(label, field.type, input.profile) : null;
    if (studied) {
      put(label, studied);
      continue;
    }
    const asked = asksYesNo(label) && !kind ? yearsQuestion(label) : null;
    if (!asked) continue;
    const total = input.profile.yearsExperience;
    if (total != null && total < asked.years) {
      put(label, { answer: "No", basis: `derived from your resume: about ${total} years of experience in total, fewer than ${asked.years}` });
      continue;
    }
    yearsAsked.push({ label, ...asked });
  }

  if (yearsAsked.length > 0 && roles.length > 0) {
    // Plain text match first; the model only for subjects no role names outright ("NoSQL databases" vs "MongoDB").
    const direct = yearsAsked.map((item) => roles.map((role, n) => (has(`${role.title} ${role.summary ?? ""}`, item.subject.toLowerCase()) ? n : -1)).filter((n) => n >= 0));
    const unresolved = yearsAsked.map((item, i) => (direct[i].length ? null : item.subject));
    const picked = await rolesInvolving(unresolved.filter((s): s is string => s !== null), roles).catch(() => []);
    let next = 0;
    for (const [i, item] of yearsAsked.entries()) {
      const chosen = direct[i].length ? direct[i] : (unresolved[i] !== null ? picked[next++] ?? [] : []);
      const used = chosen.map((n) => roles[n]);
      const years = yearsIn(used);
      if (used.length > 0 && years >= item.years) {
        put(item.label, { answer: "Yes", basis: `derived from your resume: ${years.toFixed(1)} years across ${used.map(describe).join("; ")}` });
      }
    }
  }
  return out;
}
