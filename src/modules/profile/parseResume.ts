import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { upsert } from "@/modules/answers";
import { callJson } from "@/lib/llm";
import { db } from "@/lib/db";
import { forgetFeed } from "@/lib/feed-cache";
import { storage } from "@/lib/storage";
import { profileSchema, type ParsedProfile } from "./profileSchema";
import { sampleProfile } from "./sampleProfile";

const SYSTEM = `Extract only facts written in the resume. If a field is missing, use null or an empty array. Do not guess, infer, or fill placeholders.
Return JSON with keys: fullName, email, phone, city, country, linkedin, github, portfolio, yearsExperience, currentTitle, currentCompany, skills, experience, education.
experience items: title, company, start, end, summary.
education items: school, degree, year.
yearsExperience is a number or null. skills is an array of strings.`;

type PdfParser = {
  getText: () => Promise<{ text: string }>;
  destroy: () => Promise<void>;
};

type PdfParseModule = {
  PDFParse: new (options: { data: Uint8Array }) => PdfParser;
};

async function extractText(bytes: Uint8Array) {
  const { PDFParse } = (await import("pdf-parse")) as PdfParseModule;
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.text.slice(0, 20000);
  } finally {
    await parser.destroy();
  }
}

export async function parseResumePdf(bytes: Uint8Array): Promise<{
  profile: ParsedProfile;
  resumeText: string;
  usedFallback: boolean;
}> {
  let resumeText = "";
  try {
    resumeText = (await extractText(bytes)).trim();
  } catch {
    return { profile: sampleProfile, resumeText: "", usedFallback: true };
  }
  if (!resumeText) {
    return { profile: sampleProfile, resumeText: "", usedFallback: true };
  }

  try {
    const cacheKey = createHash("sha256").update(resumeText).digest("hex");
    const profile = await callJson(profileSchema, SYSTEM, resumeText, { cacheKey });
    return { profile, resumeText, usedFallback: false };
  } catch {
    return { profile: sampleProfile, resumeText, usedFallback: true };
  }
}

function addAnswer(
  rows: Array<{ key: string; question: string; answer: string }>,
  key: string,
  question: string,
  answer: string | number | null,
) {
  if (answer == null) return;
  const text = String(answer).trim();
  if (!text) return;
  rows.push({ key, question, answer: text });
}

export function resumeAnswers(profile: ParsedProfile) {
  const [first = "", ...rest] = profile.fullName.trim().split(/\s+/);
  const rows: Array<{ key: string; question: string; answer: string }> = [];
  addAnswer(rows, "first_name", "First name", first);
  addAnswer(rows, "last_name", "Last name", rest.join(" "));
  addAnswer(rows, "full_name", "Full name", profile.fullName);
  addAnswer(rows, "email", "Email", profile.email);
  addAnswer(rows, "phone", "Phone", profile.phone);
  addAnswer(rows, "city", "City", profile.city);
  addAnswer(rows, "country", "Country", profile.country);
  addAnswer(rows, "linkedin", "LinkedIn", profile.linkedin);
  addAnswer(rows, "github", "GitHub", profile.github);
  addAnswer(rows, "portfolio", "Portfolio", profile.portfolio);
  addAnswer(rows, "years_experience", "Years of experience", profile.yearsExperience);
  addAnswer(rows, "current_title", "Current title", profile.currentTitle);
  addAnswer(rows, "current_company", "Current company", profile.currentCompany);
  return rows;
}

export async function ingestResume(userId: string, bytes: Uint8Array) {
  const key = `resumes/${userId}/resume.pdf`;
  await storage.put(key, bytes, "application/pdf", userId);
  const parsed = await parseResumePdf(bytes);
  const data = {
    resumeKey: key,
    resumeText: parsed.resumeText,
    fullName: parsed.profile.fullName,
    email: parsed.profile.email,
    phone: parsed.profile.phone,
    city: parsed.profile.city,
    country: parsed.profile.country,
    linkedin: parsed.profile.linkedin,
    github: parsed.profile.github,
    portfolio: parsed.profile.portfolio,
    yearsExperience: parsed.profile.yearsExperience,
    currentTitle: parsed.profile.currentTitle,
    currentCompany: parsed.profile.currentCompany,
    skills: parsed.profile.skills as Prisma.InputJsonValue,
    experience: parsed.profile.experience as Prisma.InputJsonValue,
    education: parsed.profile.education as Prisma.InputJsonValue,
    rawJson: parsed.profile as Prisma.InputJsonValue,
  };
  await db.profile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  forgetFeed(userId);
  for (const row of resumeAnswers(parsed.profile)) {
    await upsert(userId, { ...row, source: "resume" });
  }
  return { usedFallback: parsed.usedFallback };
}
