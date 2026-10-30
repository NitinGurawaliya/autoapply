import { z } from "zod";

// Text from a parsed resume or an edit form is cut to a sane length, never rejected: a long summary must not lose
// the whole profile, and nothing unbounded is stored.
function nullableText(max = 500) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().slice(0, max);
    return trimmed.length > 0 ? trimmed : null;
  }, z.string().nullable());
}

// A link must be an address: a resume's link text ("LinkedIn") read as the link is dropped, or a job form gets a value
// it rejects (30 Oct: Ashby refused Dhanush's LinkedIn twice and the run failed). A bare "linkedin.com/in/x" gets https://.
function nullableLink(max = 300) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().slice(0, max);
    if (!trimmed || /\s/.test(trimmed)) return null;
    try {
      const link = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      return new URL(link).hostname.includes(".") ? link : null;
    } catch {
      return null;
    }
  }, z.string().nullable());
}

const short =(max: number) => z.string().default("").transform((value) => value.slice(0, max));

export const experienceItemSchema = z.object({
  title: short(200),
  company: short(200),
  start: nullableText(40),
  end: nullableText(40),
  summary: nullableText(2000),
});

export const educationItemSchema = z.object({
  school: short(200),
  degree: nullableText(200),
  year: nullableText(40),
});

export const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: z.string().trim().min(1).max(254),
  phone: nullableText(40),
  city: nullableText(120),
  country: nullableText(120),
  linkedin: nullableLink(),
  github: nullableLink(),
  portfolio: nullableLink(),
  yearsExperience: z.preprocess((value) => {
    if (value == null || value === "") return null;
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }, z.number().nullable()),
  currentTitle: nullableText(200),
  currentCompany: nullableText(200),
  skills: z.preprocess((value) => {
    if (Array.isArray(value)) {
      return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim().slice(0, 80)).slice(0, 100);
    }
    if (typeof value === "string") {
      return value.split(",").map((item) => item.trim().slice(0, 80)).filter(Boolean).slice(0, 100);
    }
    return [];
  }, z.array(z.string())),
  experience: z.preprocess((value) => {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item === "object").slice(0, 30);
  }, z.array(experienceItemSchema)).transform((items) => items.filter((item) => item.title || item.company)),
  education: z.preprocess((value) => {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item === "object").slice(0, 20);
  }, z.array(educationItemSchema)).transform((items) => items.filter((item) => item.school)),
});

export type ParsedProfile = z.infer<typeof profileSchema>;
