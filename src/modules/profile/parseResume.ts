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
  PDFParse: (new (options: { data: Uint8Array; CanvasFactory?: unknown }) => PdfParser) & { setWorker: (worker: string) => void };
};
type PdfWorkerModule = { getData: () => string; CanvasFactory: unknown };

let workerReady = false;

async function extractText(bytes: Uint8Array) {
  // pdf-parse 2 on serverless hosts (Vercel): the worker module is loaded first and handed to the parser inline, and
  // its canvas factory is passed, or the parse fails there ("fake worker", "DOMMatrix") while it works locally.
  const worker = (await import("pdf-parse/worker")) as unknown as PdfWorkerModule;
  const { PDFParse } = (await import("pdf-parse")) as unknown as PdfParseModule;
  if (!workerReady) {
    PDFParse.setWorker(worker.getData());
    workerReady = true;
  }
  const parser = new PDFParse({ data: bytes, CanvasFactory: worker.CanvasFactory });
  try {
    const result = await parser.getText();
    return result.text.slice(0, 20000);
  } finally {
    await parser.destroy();
  }
}

export type ResumeFailure = "no_text" | "read_failed" | "parse_failed";

// Why a resume could not be read, for the logs: the error's kind and message only, never the resume's text.
const reason = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message.slice(0, 160)}` : String(error).slice(0, 160));

/**
 * The resume's text and the facts read from it. A resume that cannot be read is a failure the user is told about
 * (upload-form shows it), never a profile: before 11 Oct a failure silently saved the sample profile ("Sample Name",
 * a sample email) in production, where an application could have gone out with it. The sample is only for local
 * demos without a model key (RESUME_SAMPLE_FALLBACK=1).
 */
export async function parseResumePdf(bytes: Uint8Array): Promise<
  { ok: true; profile: ParsedProfile; resumeText: string; usedFallback: boolean } | { ok: false; failure: ResumeFailure }
> {
  const sample = process.env.RESUME_SAMPLE_FALLBACK === "1";
  let resumeText = "";
  try {
    resumeText = (await extractText(bytes)).trim();
  } catch (error) {
    console.error(`resume: could not read the PDF (${reason(error)})`);
    return sample ? { ok: true, profile: sampleProfile, resumeText: "", usedFallback: true } : { ok: false, failure: "read_failed" };
  }
  if (!resumeText) {
    // A scanned resume (an image of text) has no text to read.
    console.error("resume: the PDF has no text (scanned?)");
    return sample ? { ok: true, profile: sampleProfile, resumeText: "", usedFallback: true } : { ok: false, failure: "no_text" };
  }

  try {
    const cacheKey = createHash("sha256").update(resumeText).digest("hex");
    const profile = await callJson(profileSchema, SYSTEM, resumeText, { cacheKey });
    return { ok: true, profile, resumeText, usedFallback: false };
  } catch (error) {
    console.error(`resume: could not read the facts from the text (${reason(error)})`);
    return sample ? { ok: true, profile: sampleProfile, resumeText, usedFallback: true } : { ok: false, failure: "parse_failed" };
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
  const parsed = await parseResumePdf(bytes);
  // Nothing is saved for a resume that could not be read: the profile the user had stays as it was.
  if (!parsed.ok) return { ok: false as const, failure: parsed.failure };
  const key = `resumes/${userId}/resume.pdf`;
  await storage.put(key, bytes, "application/pdf", userId);
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
  return { ok: true as const, usedFallback: parsed.usedFallback };
}
