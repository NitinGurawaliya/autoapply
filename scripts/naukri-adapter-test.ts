// K4 (docs/naukri/TASKS.md#k4): Naukri's own Apply, offline.
//
// npx tsx scripts/naukri-adapter-test.ts
//   1. Pure: the job page's state, Naukri's apply-service replies (sent, questions, company site, 406), each drawer
//      question as a field (radio, checkboxes, chips with Skip, multi chips, text, number, date of birth, thanks only),
//      options and dates, and the words the user sees for each new outcome.
//   2. Browser, no network: the mock Naukri page (app/mock/naukri/mock.ts: Naukri's ids and drawer markup) served
//      for www.naukri.com through Playwright routes, with Naukri's two services answered by the routes: signed out,
//      already applied, company site, applied at once, a reCAPTCHA refusal, and a drawer of four questions answered
//      through to Naukri's "applied" reply; a value that fits no option, and Skip.
//   3. Database: the swipe and run gates (not connected, paused, connected; the pace after a press), on smoke rows
//      removed at the end.
import { chromium, type Page } from "playwright";
import { mockNaukriHtml } from "../src/app/mock/naukri/mock";
import { db } from "../src/lib/db";
import { explainOutcome } from "../src/lib/explain";
import { HANDOFF_QUEUE, queueFor } from "../src/lib/queue";
import { NeedsAnswerError } from "../src/modules/apply/adapter";
import { SUBMIT_ATTEMPT } from "../src/modules/apply/outcome";
import { runGate, swipeRefusal } from "../src/modules/apply/sites/gate";
import { answer, ApplyWatch, drawerSnapshot, pressApply, readJobPage, type NaukriStep } from "../src/modules/apply/sites/naukriApply";
import { dobParts, jobPageState, optionFor, optionsFor, questionOf, readApplyReply, type DrawerSnapshot } from "../src/modules/apply/sites/naukriChat";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const snap = (over: Partial<DrawerSnapshot>): DrawerSnapshot => ({ open: true, botTexts: [], messages: 1, radios: [], checkboxes: [], chips: [], multiChips: false, textBox: false, inputType: "text", dob: false, calendar: false, suggestor: false, ...over });

function pure() {
  const signals = { apply: false, companySite: false, applied: false, interest: false, text: "" };
  check("page: Apply", jobPageState({ ...signals, apply: true }) === "apply");
  check("page: Applied wins", jobPageState({ ...signals, apply: true, applied: true }) === "already_applied");
  check("page: company site", jobPageState({ ...signals, companySite: true }) === "company_site");
  check("page: expired", jobPageState({ ...signals, text: "This job is no longer available" }) === "expired");
  check("page: walk-in", jobPageState({ ...signals, interest: true }) === "interest_only");

  check("reply: applied", readApplyReply(200, { jobs: [{ jobId: "7", status: 200 }] }, "7").kind === "sent");
  check("reply: the drawer wins over a 200", readApplyReply(200, { jobs: [{ jobId: "7", status: 200 }], chatbotResponse: { speechResponse: [] } }, "7").kind === "questions");
  check("reply: company site", readApplyReply(200, { jobs: [{ jobId: "7", status: 302 }], applyRedirectUrl: "https://example.com" }, "7").kind === "company_site");
  check("reply: 406 is a check", readApplyReply(406, null, "7").kind === "refused");
  check("reply: another job's 200 is not ours", readApplyReply(200, { jobs: [{ jobId: "8", status: 200 }] }, "7").kind === "unclear");
  check("reply: not JSON", readApplyReply(200, "<html>", "7").kind === "unclear");

  const radio = questionOf(snap({ botTexts: ["Hi, kindly answer the recruiter's questions to apply.", "Are you willing to relocate?"], radios: ["Yes", "No"] }), 1);
  check("question: radio after a greeting", radio?.control === "radio" && radio.field.label === "Are you willing to relocate?" && radio.field.type === "select" && radio.field.required && radio.field.options?.join() === "Yes,No", JSON.stringify(radio?.field));
  const chips = questionOf(snap({ botTexts: ["Notice period?"], chips: ["15 Days or less", "1 Month", "Skip this question"] }), 2);
  check("question: chips with Skip are optional, Skip is not an option", chips?.control === "chips" && chips.skip === "Skip this question" && !chips.field.required && chips.field.options?.length === 2);
  const multi = questionOf(snap({ botTexts: ["Your skills?"], chips: ["Java", "React"], multiChips: true }), 3);
  check("question: multi chips are a checkbox group", multi?.control === "multi_chips" && multi.field.type === "checkbox-group");
  const boxes = questionOf(snap({ botTexts: ["Which have you used?"], checkboxes: ["A", "B"] }), 4);
  check("question: checkboxes", boxes?.control === "checkbox" && boxes.field.type === "checkbox-group");
  const text = questionOf(snap({ botTexts: ["Current CTC in lakhs?"], textBox: true, inputType: "number" }), 5);
  check("question: a number box", text?.control === "number" && text.field.type === "number");
  const suggested = questionOf(snap({ botTexts: ["Years of experience in Java?"], textBox: true, chips: ["1", "2", "3"] }), 6);
  check("question: chips beside a text box are only suggestions", suggested?.control === "text");
  const dob = questionOf(snap({ botTexts: ["Your date of birth?"], dob: true, textBox: true }), 7);
  check("question: date of birth", dob?.control === "dob" && dob.field.type === "date");
  check("question: only thanks is no question", questionOf(snap({ botTexts: ["Thank you for your responses."], textBox: true }), 8) === null);
  check("question: a closed drawer is no question", questionOf(snap({ open: false, botTexts: ["Q?"], textBox: true }), 8) === null);

  check("options: case and spacing aside", optionFor(["Yes", "No"], " yes ") === "Yes");
  check("options: none fits", optionFor(["Yes", "No"], "Maybe") === null);
  check("options: several", optionsFor(["Java", "React", "Go"], "react, Java")?.join() === "React,Java");
  check("options: one part fits none", optionsFor(["Java"], "Java, Rust") === null);
  check("dob: ISO", JSON.stringify(dobParts("1998-04-07")) === JSON.stringify({ day: "07", month: "04", year: "1998" }));
  check("dob: day first", JSON.stringify(dobParts("7/4/1998")) === JSON.stringify({ day: "07", month: "04", year: "1998" }));
  check("dob: nonsense", dobParts("April 1998") === null);

  check("words: signed out", explainOutcome("failed", "Naukri signed you out. Sign in to Naukri again from Account, then retry. Nothing was sent.").headline === "Naukri signed you out");
  check("words: a check", explainOutcome("failed", "Naukri asked for a check (a CAPTCHA), so your agent paused Naukri for 24 hours. Nothing was sent.").headline === "Naukri wanted a person");
  check("words: company site", explainOutcome("failed", "Naukri sends this job's applications to the company's own site. Apply there.").headline === "Apply on the company site");
  check("queue: Naukri runs only on a worker with a screen", queueFor("naukri") === HANDOFF_QUEUE && queueFor("greenhouse") !== HANDOFF_QUEUE);
  check("words: blocked rules are named", ["source_not_connected", "source_paused", "max_applies_per_day_naukri", "already_applied_on_site"].every((rule) => explainOutcome("blocked", rule).headline !== "Your agent held this one back"));
}

const JOB_URL = "https://www.naukri.com/job-listings-java-full-stack-developer-fixture-bengaluru-1-to-3-years-fixture1";
// The mock Naukri page (app/mock/naukri) as if Naukri served it: its services at naukri.com's own paths.
const html = mockNaukriHtml({ jobId: "fixture1", services: "https://www.naukri.com" });

async function routed(page: Page, applyReply: (body: { applyData?: unknown }) => { status: number; json: unknown }) {
  await page.route("https://www.naukri.com/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/apply-workflow/v1/apply")) {
      const reply = applyReply((route.request().postDataJSON() ?? {}) as { applyData?: unknown });
      return route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.json) });
    }
    if (url.includes("/botapi/v5/respond")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ speechResponse: [{ type: "text", response: "next" }], options: [] }) });
    if (url.startsWith(JOB_URL)) return route.fulfill({ status: 200, contentType: "text/html", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
}

const questionsReply = (body: { applyData?: unknown }) =>
  body.applyData ? { status: 200, json: { jobs: [{ jobId: "fixture1", status: 200 }] } } : { status: 200, json: { jobs: [{ jobId: "fixture1", status: 200 }], chatbotResponse: { speechResponse: [{ type: "text", response: "Hi" }] } } };

async function browserChecks() {
  const browser = await chromium.launch({ headless: true });
  const open = async (flow: string, reply: (body: { applyData?: unknown }) => { status: number; json: unknown } = questionsReply) => {
    const page = await browser.newPage();
    await routed(page, reply);
    await page.goto(`${JOB_URL}#${flow}`);
    return page;
  };
  try {
    const signedOut = await readJobPage(await open("signedout"));
    check("window: signed out stops before pressing", signedOut.kind === "stop" && signedOut.stop === "needs_signin", JSON.stringify(signedOut));
    const applied = await readJobPage(await open("applied"));
    check("window: already applied", applied.kind === "state" && applied.state === "already_applied");
    const company = await readJobPage(await open("company"));
    check("window: company site", company.kind === "state" && company.state === "company_site");

    const instantPage = await open("instant", () => ({ status: 200, json: { jobs: [{ jobId: "fixture1", status: 200 }] } }));
    const ready = await readJobPage(instantPage);
    const instant = await pressApply(instantPage, new ApplyWatch(instantPage, "fixture1"));
    check("window: a job with no questions is sent on Apply", ready.kind === "state" && ready.state === "apply" && instant.kind === "sent", JSON.stringify(instant));

    const refusedPage = await open("refuse", () => ({ status: 406, json: { message: "recaptcha required" } }));
    const refused = await pressApply(refusedPage, new ApplyWatch(refusedPage, "fixture1"));
    check("window: Naukri's 406 stops as a check", refused.kind === "stopped" && refused.stop === "challenge", JSON.stringify(refused));

    // The drawer, four questions through to "applied".
    const page = await open("questions");
    const watch = new ApplyWatch(page, "fixture1");
    let step: NaukriStep = await pressApply(page, watch);
    const seen: string[] = [];
    const replies: Record<string, string> = { radio: "yes", text: "12 LPA", chips: "1 Month", dob: "1998-04-07" };
    let n = 0;
    while (step.kind === "question" && n < 6) {
      n += 1;
      seen.push(`${step.question.control}:${step.question.field.label}`);
      step = await answer(page, watch, step, replies[step.question.control] ?? "x", n);
    }
    check("window: four questions, in order, as fields", seen.join(" | ") === "radio:Are you willing to relocate to Bengaluru? | text:What is your current CTC? | chips:What is your notice period? | dob:What is your date of birth?", seen.join(" | "));
    check("window: sent when Naukri's apply reply says so", step.kind === "sent", JSON.stringify(step));
    const typed = await page.evaluate(() => (window as unknown as { __answers?: string[] }).__answers ?? []);
    check("window: the drawer got Naukri's own option words and a date in its three boxes", typed.join("|") === "Yes|12 LPA|1 Month|07/04/1998", typed.join("|"));
    check("window: the job page then says Applied", await page.locator("#already-applied").isVisible());

    // A saved value that fits none of the options: nothing sent, the question goes to the user.
    const misfitPage = await open("questions");
    const misfitWatch = new ApplyWatch(misfitPage, "fixture1");
    const first = await pressApply(misfitPage, misfitWatch);
    let asked: string | null = null;
    if (first.kind === "question") await answer(misfitPage, misfitWatch, first, "Maybe", 1).catch((error) => (asked = error instanceof NeedsAnswerError ? error.question.label : null));
    const drawerStillOpen = (await drawerSnapshot(misfitPage)).open;
    check("window: a value no option means is asked, with the drawer still open", asked === "Are you willing to relocate to Bengaluru?" && drawerStillOpen, String(asked));

    // Skip on an optional question.
    const skipPage = await open("questions");
    const skipWatch = new ApplyWatch(skipPage, "fixture1");
    let skipStep: NaukriStep = await pressApply(skipPage, skipWatch);
    let m = 0;
    while (skipStep.kind === "question" && m < 6) {
      m += 1;
      skipStep = await answer(skipPage, skipWatch, skipStep, skipStep.question.control === "chips" ? null : (replies[skipStep.question.control] ?? "x"), m);
    }
    const skipped = await skipPage.evaluate(() => (window as unknown as { __answers?: string[] }).__answers ?? []);
    check("window: an optional question is skipped with Naukri's own Skip", skipStep.kind === "sent" && skipped[2] === "Skip this question", skipped.join("|"));
  } finally {
    await browser.close();
  }
}

async function gates() {
  const stamp = Date.now();
  const user = await db.user.create({ data: { email: `naukri-adapter-${stamp}@swipeapply.local` } });
  const company = await db.company.create({ data: { slug: `smoke${stamp}`, name: "Smoke Co", source: "naukri", active: false } });
  try {
    const job = { source: "naukri", applyVia: null };
    check("gate: not connected refuses the swipe", (await swipeRefusal(user.id, job))?.rule === "source_not_connected");
    const connection = await db.siteConnection.create({ data: { userId: user.id, site: "naukri", status: "limited", consentAt: new Date(), pausedUntil: new Date(Date.now() + 3600_000) } });
    check("gate: paused refuses the swipe", (await swipeRefusal(user.id, job))?.rule === "source_paused");
    await db.siteConnection.update({ where: { id: connection.id }, data: { status: "connected", pausedUntil: null } });
    check("gate: connected lets the swipe through", (await swipeRefusal(user.id, job)) === null);
    check("gate: a job Naukri sends to another board is refused", (await swipeRefusal(user.id, { source: "naukri", applyVia: "greenhouse" }))?.rule === "board_not_supported");
    check("gate: other boards are not its business", (await swipeRefusal(user.id, { source: "greenhouse", applyVia: null })) === null);
    check("gate: the run goes", (await runGate(user.id, "naukri")).kind === "go");
    const row = await db.job.create({ data: { companyId: company.id, source: "naukri", externalId: `smoke${stamp}`, title: "Smoke", location: "Bengaluru", country: "IN", applyUrl: "https://www.naukri.com/job-listings-smoke", description: "", remoteType: "onsite", postedAt: new Date(), fetchedAt: new Date(), raw: {} } });
    const app = await db.application.create({ data: { userId: user.id, jobId: row.id, status: "submitted", fields: [], pendingQuestions: [] } });
    await db.applicationEvent.create({ data: { applicationId: app.id, type: SUBMIT_ATTEMPT, message: "smoke press" } });
    const paced = await runGate(user.id, "naukri", new Date(), () => 0);
    check("gate: a press a moment ago makes the next run wait about a minute", paced.kind === "wait" && paced.rule === "min_minutes_between_applies_naukri" && paced.seconds >= 55 && paced.seconds <= 66, JSON.stringify(paced));
    const later = await runGate(user.id, "naukri", new Date(Date.now() + 2 * 60_000));
    check("gate: two minutes later it goes", later.kind === "go");
  } finally {
    await db.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await db.job.deleteMany({ where: { companyId: company.id } });
    await db.company.delete({ where: { id: company.id } }).catch(() => undefined);
    await db.$disconnect();
  }
}

async function main() {
  pure();
  await browserChecks();
  await gates();
  console.log(failed === 0 ? "PASS naukri-adapter-test" : `FAIL naukri-adapter-test (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
