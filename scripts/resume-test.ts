// Resume upload and replace (18 Oct). 1) Reading a PDF leaves the bytes whole: pdf.js emptied the caller's array, and
// every resume saved from 12 to 18 Oct was stored as 0 bytes, so no form could upload it. 2) The merge rules: a new
// resume keeps the person's details (a blank one is filled) and replaces skills, roles, education and title. 3) A
// replace against the database: the file is stored whole, details and the user's own answers stay, the AI "best
// project" draft is dropped, the changes are reported. Synthetic data, a throwaway user removed at the end.
// npx tsx scripts/resume-test.ts
import { db } from "../src/lib/db";
import { storage } from "../src/lib/storage";
import { deleteAccount } from "../src/modules/account";
import { mergeResumeProfile, parseResumePdf, saveParsedResume } from "../src/modules/profile/parseResume";
import type { ParsedProfile } from "../src/modules/profile/profileSchema";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

/** A one-page PDF with a line of synthetic text. */
function syntheticPdf(text: string) {
  const body = `BT /F1 14 Tf 72 720 Td (${text}) Tj ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", `<< /Length ${body.length} >>\nstream\n${body}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

const parsed = (over: Partial<ParsedProfile>): ParsedProfile => ({
  fullName: "Resume Name", email: "resume@example.test", phone: "+91 90000 11111", city: "Pune", country: "India",
  linkedin: null, github: null, portfolio: null, yearsExperience: 2, currentTitle: "Backend Engineer", currentCompany: "New Co",
  skills: ["Go", "PostgreSQL"], experience: [{ title: "Backend Engineer", company: "New Co" }], education: [{ school: "New College", degree: "B.Tech", year: "2023" }],
  ...over,
} as ParsedProfile);

async function main() {
  // 1. The bytes stay whole after reading.
  const bytes = syntheticPdf("Test Person Software Engineer");
  const size = bytes.length;
  await parseResumePdf(bytes).catch(() => undefined);
  check("reading a PDF leaves the uploaded bytes whole (not emptied by the PDF reader)", bytes.length === size && size > 0, `${size} -> ${bytes.length}`);

  // 2. Merge rules, offline.
  const existing = { fullName: "Hand Fixed Name", email: "me@example.test", phone: "+91 98888 77777", city: "Bengaluru", country: "India", linkedin: "linkedin.com/in/me", github: null, portfolio: null, skills: ["React", "Go"], experience: [{ title: "Frontend Engineer", company: "Old Co" }], education: [], currentTitle: "Frontend Engineer" };
  const { core, changes } = mergeResumeProfile(existing, parsed({ github: "github.com/me" }));
  check("a new resume keeps the person's details", core.fullName === "Hand Fixed Name" && core.phone === "+91 98888 77777" && core.city === "Bengaluru" && core.linkedin === "linkedin.com/in/me", JSON.stringify(core));
  check("a blank detail is filled from the new resume", core.github === "github.com/me");
  check("the changes list skills, roles and title", changes.replaced && changes.skillsAdded.includes("PostgreSQL") && changes.skillsRemoved.includes("React") && !changes.skillsAdded.includes("Go") && changes.rolesAdded[0] === "Backend Engineer at New Co" && changes.rolesRemoved[0] === "Frontend Engineer at Old Co" && changes.title?.to === "Backend Engineer", JSON.stringify(changes));
  check("details the resume had differently are reported as kept", changes.keptCore.includes("phone") && changes.keptCore.includes("city") && !changes.keptCore.includes("github"), changes.keptCore.join(","));
  const first = mergeResumeProfile(null, parsed({}));
  check("a first resume takes everything", first.core.fullName === "Resume Name" && first.core.city === "Pune" && !first.changes.replaced);

  // 3. A replace against the database.
  const user = await db.user.create({ data: { email: `resume-test-${Date.now()}@swipeapply.local`, name: "Resume Test" } });
  try {
    await db.profile.create({ data: { userId: user.id, resumeKey: `resumes/${user.id}/resume.pdf`, resumeText: "old", fullName: "Hand Fixed Name", email: user.email, phone: "+91 98888 77777", city: "Bengaluru", country: "India", currentTitle: "Frontend Engineer", skills: ["React"], experience: [{ title: "Frontend Engineer", company: "Old Co" }], education: [], rawJson: {} } });
    await db.answer.createMany({ data: [
      { userId: user.id, key: "phone", question: "Phone", answer: "+91 98888 77777", source: "user" },
      { userId: user.id, key: "notice_period", question: "Notice period", answer: "30 days", source: "user" },
      { userId: user.id, key: "essay_best_project", question: "Best project", answer: "Old project essay", source: "ai_draft" },
    ] });
    const result = await saveParsedResume(user.id, bytes, { profile: parsed({}), resumeText: "new resume text", usedFallback: false });
    const profile = await db.profile.findUniqueOrThrow({ where: { userId: user.id } });
    const file = await storage.get(profile.resumeKey);
    const answers = new Map((await db.answer.findMany({ where: { userId: user.id } })).map((a) => [a.key, a]));
    check("the stored resume file is whole", (file?.bytes.length ?? 0) === size, `${file?.bytes.length} bytes`);
    check("details stay, resume content is replaced", profile.fullName === "Hand Fixed Name" && profile.city === "Bengaluru" && profile.currentTitle === "Backend Engineer" && JSON.stringify(profile.skills) === JSON.stringify(["Go", "PostgreSQL"]) && profile.resumeText === "new resume text");
    check("the user's own answers stay", answers.get("phone")?.answer === "+91 98888 77777" && answers.get("phone")?.source === "user" && answers.get("notice_period")?.answer === "30 days");
    check("the AI 'best project' draft from the old resume is dropped", !answers.has("essay_best_project"));
    check("the upload reports what changed", result.ok && result.changes.replaced && result.changes.skillsAdded.includes("Go"));
  } finally {
    await deleteAccount(user.id);
  }

  console.log(failed ? `FAIL resume (${failed})` : "PASS resume");
  process.exit(failed ? 1 : 0);
}

main().finally(() => db.$disconnect());
