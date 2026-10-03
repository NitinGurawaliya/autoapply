import { z } from "zod";

function nullableText() {
  return z.preprocess((value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, z.string().nullable());
}

export const experienceItemSchema = z.object({
  title: z.string().default(""),
  company: z.string().default(""),
  start: nullableText(),
  end: nullableText(),
  summary: nullableText(),
});

export const educationItemSchema = z.object({
  school: z.string().default(""),
  degree: nullableText(),
  year: nullableText(),
});

export const profileSchema = z.object({
  fullName: z.string().trim().min(1),
  email: z.string().trim().min(1),
  phone: nullableText(),
  city: nullableText(),
  country: nullableText(),
  linkedin: nullableText(),
  github: nullableText(),
  portfolio: nullableText(),
  yearsExperience: z.preprocess((value) => {
    if (value == null || value === "") return null;
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }, z.number().nullable()),
  currentTitle: nullableText(),
  currentCompany: nullableText(),
  skills: z.preprocess((value) => {
    if (Array.isArray(value)) {
      return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
    }
    if (typeof value === "string") {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
    return [];
  }, z.array(z.string())),
  experience: z.preprocess((value) => {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item === "object");
  }, z.array(experienceItemSchema)).transform((items) => items.filter((item) => item.title || item.company)),
  education: z.preprocess((value) => {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item === "object");
  }, z.array(educationItemSchema)).transform((items) => items.filter((item) => item.school)),
});

export type ParsedProfile = z.infer<typeof profileSchema>;
