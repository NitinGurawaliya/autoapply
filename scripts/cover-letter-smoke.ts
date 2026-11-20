// Cover letters asked for as a file (letter.ts, 20 Nov). Offline: the PDF reads back as the letter, the line wrap, and the
// resolver leaves a required cover letter to the run's draft (or asks, for a user who said No to drafts). With --run
// (dev server on :3000, a screen for the stealthy Chrome): a real run on /mock/greenhouse?letter=1 with the test profile
// drafts the letter, attaches it as "Cover letter.pdf" beside the resume, and submits.
// npx tsx scripts/cover-letter-smoke.ts [--run]
import { db } from "../src/lib/db";
import { LETTER_FILE, letterPdf, wrapLetter } from "../src/modules/apply/letter";
import { resolveForm } from "../src/modules/apply/resolveForm";
import { runApplication } from "../src/modules/apply/runner";
import type { FormField } from "../src/modules/apply/adapter";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

type PdfParseModule = { PDFParse: { new (options: { data: Uint8Array; CanvasFactory?: unknown }): { getText(): Promise<{ text: string; total?: number }>; destroy(): Promise<void> }; setWorker(src: string): void } };
async function pdfText(bytes: Uint8Array) {
  const worker = (await import("pdf-parse/worker")) as unknown as { getData: () => string; CanvasFactory: unknown };
  const { PDFParse } = (await import("pdf-parse")) as unknown as PdfParseModule;
  PDFParse.setWorker(worker.getData());
  const parser = new PDFParse({ data: bytes.slice(), CanvasFactory: worker.CanvasFactory });
  try {
    return await parser.getText();
  } finally {
    await parser.destroy();
  }
}

const LETTER = `Dear Hiring Team,

I am applying for the Software Engineer role at Acme (Bengaluru). I build full-stack apps with React, Node.js and FastAPI — "end to end", from the API to the UI.

${"At my last role I shipped a search feature used by every customer. ".repeat(12)}

Regards,
Asha Rao`;

const MOCK_FIELDS: FormField[] = [
  { selector: "#first_name", label: "First name", type: "text", required: true },
  { selector: "#resume", label: "Resume", type: "file", required: true },
  { selector: "#cover_letter", label: "Cover letter", type: "file", required: true },
];

async function offline() {
  const bytes = letterPdf(LETTER);
  const head = Buffer.from(bytes.slice(0, 8)).toString("latin1");
  check("the letter is a PDF", head.startsWith("%PDF-1.4"), head);
  const read = await pdfText(bytes);
  const flat = read.text.replace(/\s+/g, " ");
  check("the PDF reads back as the letter: greeting, sign-off and name", flat.includes("Dear Hiring Team,") && flat.includes("Regards,") && flat.includes("Asha Rao"), flat.slice(0, 80));
  check("brackets and quotes survive, dashes are made plain", flat.includes("Acme (Bengaluru)") && flat.includes('"end to end"') && flat.includes("FastAPI - "), flat.slice(60, 200));
  const lines = wrapLetter(LETTER);
  check("no line is wider than the page", lines.every((line) => line.length <= 92), String(Math.max(...lines.map((line) => line.length))));
  check("paragraphs keep one blank line between them", lines.filter((line) => line === "").length === 3, String(lines.filter((line) => line === "").length));
  const long = letterPdf(`${"word ".repeat(1200)}`);
  check("a long letter runs onto more pages", ((await pdfText(long)).total ?? 0) >= 2);

  // The resolver: a required cover letter is left to the run's draft; a user who said No to drafts is asked for it.
  const user = await db.user.findUniqueOrThrow({ where: { email: "t12-check@swipeapply.local" }, include: { profile: true } });
  const profile = user.profile!;
  const job = { company: "Acme", title: "Software Engineer", location: "Bengaluru", country: "IN", description: "Build web apps with React." };
  const base = { userId: user.id, source: "mock", fields: MOCK_FIELDS, profile: profile as never, job, draftEssays: false };
  const drafted = await resolveForm({ ...base, answers: [] });
  check("a required cover letter is drafted by the run, not asked", !drafted.missing.some((q) => q.label === "Cover letter"), drafted.missing.map((q) => q.label).join(","));
  const refused = await resolveForm({ ...base, answers: [{ key: "accept_ai_essays", answer: "No", source: "user", updatedAt: new Date() }] });
  check("with No to drafts, the cover letter is asked", refused.missing.some((q) => q.label === "Cover letter"));
  const own = await resolveForm({ ...base, answers: [{ key: "cover_letter", answer: LETTER, source: "user", updatedAt: new Date() }] });
  const value = own.resolved.values.find((v) => v.label === "Cover letter");
  check("a saved letter is used for the file, as the user's own", value?.type === "file" && value.source === "user" && value.value === LETTER);
  check("the resume stays the resume", own.resolved.values.find((v) => v.label === "Resume")?.key === "resume");
}

async function run() {
  const user = await db.user.findUniqueOrThrow({ where: { email: "t12-check@swipeapply.local" } });
  const base = await db.job.findUniqueOrThrow({ where: { source_externalId: { source: "mock", externalId: "greenhouse" } } });
  const job = await db.job.upsert({
    where: { source_externalId: { source: "mock", externalId: "greenhouse-letter" } },
    create: { ...base, id: undefined, externalId: "greenhouse-letter", applyUrl: "http://localhost:3000/mock/greenhouse?letter=1", raw: {}, title: "Software Engineer (cover letter)" } as never,
    update: { applyUrl: "http://localhost:3000/mock/greenhouse?letter=1", closedAt: null },
  });
  const since = new Date();
  await db.swipe.upsert({ where: { userId_jobId: { userId: user.id, jobId: job.id } }, create: { userId: user.id, jobId: job.id, direction: "right" }, update: { direction: "right" } });
  const app = await db.application.create({ data: { userId: user.id, jobId: job.id, status: "queued", fields: [], pendingQuestions: [] } });
  try {
    await runApplication(app.id);
    const row = await db.application.findUniqueOrThrow({ where: { id: app.id } });
    const events = await db.applicationEvent.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "asc" } });
    const fill = events.find((event) => event.type === "fill" && (event.data as { key?: string } | null)?.key === "cover_letter");
    check("the run submitted", row.status === "submitted", `${row.status} ${row.error ?? ""}`);
    check("the cover letter was filled as an AI draft", (fill?.data as { source?: string } | null)?.source === "ai_draft", JSON.stringify(fill?.data ?? null).slice(0, 120));
    const sent = await db.mockSubmission.findFirst({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
    const payload = sent?.payload as { resumeFileName?: string; coverLetter?: { name: string; bytes: number } } | undefined;
    check("the form got the resume and the letter as two files", !!payload?.resumeFileName && payload.coverLetter?.name === LETTER_FILE && payload.coverLetter.bytes > 500, JSON.stringify({ resume: payload?.resumeFileName, letter: payload?.coverLetter }));
    if (sent) await db.mockSubmission.delete({ where: { id: sent.id } });
  } finally {
    await db.applicationEvent.deleteMany({ where: { applicationId: app.id } });
    await db.application.delete({ where: { id: app.id } });
    await db.swipe.deleteMany({ where: { userId: user.id, jobId: job.id } });
  }
}

async function main() {
  await offline();
  if (process.argv.includes("--run")) await run();
  console.log(failed === 0 ? "PASS cover-letter" : `FAIL cover-letter (${failed})`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}
main();
