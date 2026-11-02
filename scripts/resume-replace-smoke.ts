// Replacing a resume (2 Nov QA): a PDF with no text is refused and changes nothing; a model's "null" is no value; a
// resume with no name anywhere is refused; saving the review screen writes only the details changed there, removes
// the answer of one cleared, and leaves the saved answers alone. Needs `npm run dev`. Uses its own temporary users.
// npx tsx scripts/resume-replace-smoke.ts
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { storage } from "../src/lib/storage";
import { deleteAccount } from "../src/modules/account";
import { customQuestionKey } from "../src/modules/answers";
import { parseResumePdf, profileSchema } from "../src/modules/profile";
import { saveParsedResume } from "../src/modules/profile/parseResume";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` (${detail})` : ""}`);
}
const BASE = "http://localhost:3000";
const stamp = Date.now();

/** A one-page PDF; with no content stream text it has no text layer, as a scanned resume. */
function pdf(body: string) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", `<< /Length ${body.length} >>\nstream\n${body}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((obj, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

const parsed = { fullName: "", email: "", phone: null, city: null, country: null, linkedin: null, github: null, portfolio: null, yearsExperience: 2, currentTitle: "Backend Engineer", currentCompany: "New Co", skills: ["Go"], experience: [], education: [] };

async function main() {
  const users: string[] = [];
  try {
    // 1. No text layer: refused before the model, nothing saved.
    const blank = await parseResumePdf(pdf(""));
    check("a PDF with no text is refused as no_text", !blank.ok && blank.failure === "no_text", JSON.stringify(blank));

    // 2. The model's placeholders are no value.
    const read = profileSchema.parse({ fullName: "A Person", email: "a@example.test", phone: "null", city: "N/A", country: "Not found", linkedin: "null", github: "none", portfolio: null, yearsExperience: null, currentTitle: "null", currentCompany: null, skills: [], experience: [], education: [] });
    check("'null', 'N/A', 'Not found' and 'none' are read as missing", [read.phone, read.city, read.country, read.linkedin, read.github, read.currentTitle].every((value) => value === null), JSON.stringify(read));

    // 3. No name on the resume and none on the account: refused, nothing stored.
    const nameless = await db.user.create({ data: { email: `replace-noname-${stamp}@swipeapply.local` } });
    users.push(nameless.id);
    const refused = await saveParsedResume(nameless.id, pdf("BT /F1 12 Tf 72 720 Td (x) Tj ET"), { profile: parsed, resumeText: "x", usedFallback: false });
    check("a resume with no name anywhere is refused as no_name", !refused.ok && refused.failure === "no_name", JSON.stringify(refused));
    check("and nothing is stored for it", !(await db.profile.findUnique({ where: { userId: nameless.id } })) && !(await storage.get(`resumes/${nameless.id}/resume.pdf`)));

    // 4. The review screen's save.
    const user = await db.user.create({ data: { email: `replace-${stamp}@swipeapply.local`, name: "Replace Smoke" } });
    users.push(user.id);
    await db.profile.create({ data: { userId: user.id, isTest: true, resumeKey: `resumes/${user.id}/resume.pdf`, resumeText: "x", fullName: "Replace Smoke", email: user.email, phone: "+91 98888 77777", city: "Pune", country: "India", linkedin: "linkedin.com/in/bare-link", currentTitle: "Backend Engineer", skills: ["Go"], experience: [], education: [], rawJson: {} } });
    const saved = Array.from({ length: 80 }, (_, i) => ({ userId: user.id, key: customQuestionKey(`replace smoke ${stamp} ${i}`), question: `Question ${i}`, answer: `answer ${i}`, source: i % 2 ? "user" : "derived" }));
    await db.answer.createMany({
      data: [
        ...saved,
        { userId: user.id, key: "phone", question: "Phone", answer: "+91 98888 77777", source: "resume" },
        { userId: user.id, key: "city", question: "City", answer: "Pune", source: "resume" },
        { userId: user.id, key: "linkedin", question: "LinkedIn", answer: "linkedin.com/in/bare-link", source: "resume" },
        { userId: user.id, key: "current_title", question: "Current title", answer: "Backend Engineer", source: "resume" },
      ],
    });
    const token = randomBytes(16).toString("hex");
    await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 1_800_000) } });
    const before = new Map((await db.answer.findMany({ where: { userId: user.id } })).map((row) => [row.key, row]));

    // What the review screen sends: the stored profile as it shows it, phone cleared, city and title changed.
    const response = await fetch(`${BASE}/api/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: `authjs.session-token=${token}` },
      body: JSON.stringify({ fullName: "Replace Smoke", email: user.email, phone: null, city: "Chennai", country: "India", linkedin: "https://linkedin.com/in/bare-link", github: null, portfolio: null, yearsExperience: null, currentTitle: "Senior Backend Engineer", currentCompany: null, skills: ["Go"], experience: [], education: [], tracks: [] }),
    });
    check("the review screen's save succeeds", response.ok, String(response.status));
    const after = new Map((await db.answer.findMany({ where: { userId: user.id } })).map((row) => [row.key, row]));
    check("a changed detail is the user's answer now", after.get("city")?.answer === "Chennai" && after.get("city")?.source === "user" && after.get("current_title")?.answer === "Senior Backend Engineer", JSON.stringify(after.get("city")));
    check("a cleared detail has no answer left", !after.has("phone"), JSON.stringify(after.get("phone")));
    check("an unchanged link without https:// is not rewritten", after.get("linkedin")?.updatedAt.getTime() === before.get("linkedin")?.updatedAt.getTime() && after.get("linkedin")?.source === "resume", JSON.stringify(after.get("linkedin")));
    const kept = saved.every((row) => {
      const now = after.get(row.key);
      return now?.answer === row.answer && now.source === row.source && now.updatedAt.getTime() === before.get(row.key)?.updatedAt.getTime();
    });
    check("all 80 saved answers are untouched", kept);
  } finally {
    for (const id of users) await deleteAccount(id).catch(() => undefined);
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS resume-replace" : `FAIL resume-replace (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
