// Applications list and detail (T36), at 390 px: summary strip, plain-language outcomes, grouped fields,
// step timeline, collapsible screenshot. Needs `npm run dev`. Test account and fixtures only.
// npx tsx scripts/applications-smoke.ts [screenshotDir]
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { db } from "../src/lib/db";
import { storage } from "../src/lib/storage";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const BASE = "http://localhost:3000";
const OUT = process.argv[2] ?? `${process.env.TEMP ?? "."}/swipeapply-apps`;
// A 1x1 transparent PNG.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));

async function main() {
  mkdirSync(OUT, { recursive: true });
  const user = await db.user.findUnique({ where: { email: "t12-check@swipeapply.local" } });
  const job = await db.job.findFirst({ where: { source: "greenhouse" }, include: { company: true } });
  if (!user || !job) throw new Error("test user or greenhouse job missing");
  const token = randomBytes(16).toString("hex");
  const session = await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 1_800_000) } });
  const ids: string[] = [];
  const make = async (status: string, extra: Record<string, unknown> = {}) => {
    const app = await db.application.create({ data: { userId: user.id, jobId: job.id, status, fields: [], pendingQuestions: [], ...extra } as never });
    ids.push(app.id);
    return app;
  };
  const event = (applicationId: string, type: string, message: string, rule?: string) => db.applicationEvent.create({ data: { applicationId, type, message, rule: rule ?? null } });

  const fields = [
    { key: "first_name", label: "First Name", value: "Test", source: "user", selector: "#a" },
    { key: "email", label: "Email", value: "test@example.com", source: "user", selector: "#b" },
    { key: "resume", label: "Resume/CV", value: "resume.pdf", source: "resume", selector: "#c" },
    { key: "linkedin", label: "LinkedIn Profile", value: "linkedin.com/in/test", source: "user", selector: "#d" },
    { key: "q_0123456789ab", label: "Are you authorized to work in India?", value: "Yes", source: "user", selector: "#e" },
    { key: "cover_letter", label: "Cover letter", value: "A short draft", source: "ai_draft", selector: "#f" },
    { key: "gender", label: "Gender", value: "Decline to answer", source: "default", selector: "#g" },
    // T57: answers from the user's data show their badge and why.
    { key: "q_aaaaaaaaaaa1", label: "How did you learn about this opportunity?", value: "LinkedIn", source: "matched", selector: "#h", basis: 'your answer to "How did you hear about this job?" (OpenAI)' },
    { key: "q_aaaaaaaaaaa2", label: "Do you reside in the United States?", value: "No", source: "derived", selector: "#i", basis: "derived from your location: Pune, India" },
  ];
  const browser = await chromium.launch();
  try {
    const sent = await make("submitted", { fields, submittedAt: new Date(), screenshotKey: "" });
    await storage.put(`screenshots/${sent.id}/1.png`, PNG, "image/png", user.id);
    await db.application.update({ where: { id: sent.id }, data: { screenshotKey: `screenshots/${sent.id}/1.png` } });
    for (const [type, message, rule] of [["rule_check", "swipe_right passed", "swipe_right"], ["rule_check", "start passed", "start"], ["inspect", "Found 7 fields", ""], ["resolve", "Resolved 7, pending 0", ""], ["fill", "Filled first_name", ""], ["screenshot", "shot", ""], ["submit", 'Application submitted. Confirmation: text "Thank you for applying"', ""]] as const) {
      await event(sent.id, type, message, rule || undefined);
    }
    const failedApp = await make("failed", { error: "Greenhouse rejected the form: Phone, Email" });
    for (const [type, message] of [["rule_check", "swipe_right passed"], ["inspect", "Found 7 fields"], ["error", "Greenhouse rejected the form: Phone, Email"]] as const) await event(failedApp.id, type, message);
    const blockedApp = await make("blocked", { error: "min_match_score" });
    await event(blockedApp.id, "block", "Match score 35 is below 40", "min_match_score");
    const cancelledApp = await make("cancelled", { error: "Cancelled by you" });
    const running = await make("filling");

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: "authjs.session-token", value: token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();

    // ---------- list
    await page.goto(`${BASE}/applications`, { timeout: 90000 });
    await page.locator(`li:has(a[href="/applications/${sent.id}"])`).waitFor({ timeout: 30000 });
    await page.screenshot({ path: `${OUT}/list.png`, fullPage: true });
    // Filter chips with counts (design/applications.html): All, Needs you, In progress, Sent, Didn't go through.
    const chips = page.getByRole("group", { name: "Show" });
    const chip = (name: RegExp) => chips.getByRole("button", { name });
    const total = async (statuses: string[]) => db.application.count({ where: { userId: user.id, status: { in: statuses } } });
    const chipCount = async (name: RegExp) => Number((await chip(name).innerText()).replace(/\D+/g, " ").trim().split(" ").pop());
    check("the Sent chip counts submitted applications", (await chipCount(/^Sent/)) === (await total(["submitted"])));
    check("the In progress chip counts queued, reading and filling", (await chipCount(/^In progress/)) === (await total(["queued", "inspecting", "filling"])));
    check("the Didn't go through chip counts failed, blocked and cancelled", (await chipCount(/^Didn.t go through/)) === (await total(["failed", "blocked", "cancelled"])));

    const failedRow = page.locator(`li:has(a[href="/applications/${failedApp.id}"])`);
    const blockedRow = page.locator(`li:has(a[href="/applications/${blockedApp.id}"])`);
    const failedText = await failedRow.innerText();
    check("a failed row says what went wrong in plain words", /The form rejected some answers/.test(failedText) && !/Greenhouse rejected the form:/.test(failedText), failedText.replace(/\s+/g, " ").slice(0, 120));
    check("a blocked row names the rule in plain words and has nothing to do", /Match too low/.test(await blockedRow.innerText()) && /Nothing to do/.test(await blockedRow.innerText()));
    check("a failed row offers Retry", await failedRow.getByRole("button", { name: "Retry" }).isVisible());
    check("rows show a company tile", (await failedRow.locator("[data-company-mark]").count()) === 1);
    check("a sent row shows the ink check and says Sent", /Sent/.test(await page.locator(`li:has(a[href="/applications/${sent.id}"])`).innerText()));

    await chip(/^Didn.t go through/).click();
    check("tapping a chip marks it pressed and filters the list", (await chip(/^Didn.t go through/).getAttribute("aria-pressed")) === "true" && (await page.locator("ul li").count()) === (await total(["failed", "blocked", "cancelled"])));
    check("only didn't-go-through rows remain", (await page.locator("li[data-row]").evaluateAll((els) => els.every((el) => el.getAttribute("data-row") === "failed"))));
    await chip(/^All/).click();
    // All shows every active application and the newest 25 finished ones; the rest load with Show more (T73).
    const active = await total(["needs_input", "queued", "inspecting", "filling"]);
    const firstPage = active + Math.min(25, (await db.application.count({ where: { userId: user.id } })) - active);
    await page.waitForFunction((n) => document.querySelectorAll("ul li").length === n, firstPage, { timeout: 30000 }).catch(() => undefined);
    check("All brings the first page of every group back", (await page.locator("ul li").count()) === firstPage, `${await page.locator("ul li").count()} of ${firstPage}`);
    check("All is pressed again", (await chip(/^All/).getAttribute("aria-pressed")) === "true");

    // ---------- detail: submitted
    await page.goto(`${BASE}/applications/${sent.id}`, { timeout: 90000 });
    await page.locator('section[aria-label="What was filled in"]').waitFor({ timeout: 30000 });
    await page.screenshot({ path: `${OUT}/detail-submitted.png`, fullPage: true });
    const main = await page.locator("main").innerText();
    check("fields are grouped under plain headings", ["CONTACT", "LINKS", "DOCUMENTS", "YOUR ANSWERS", "EQUAL OPPORTUNITY"].every((h) => main.toUpperCase().includes(h)));
    check("the field count is shown", /9 fields/i.test(main));
    check("every filled value shows its source", ["You", "Resume", "AI draft", "Default"].every((s) => main.includes(s)));
    check("reused and worked-out answers show their badge and why", main.includes("You · reused") && main.includes("Worked out") && main.includes('Why: your answer to "How did you hear about this job?" (OpenAI)') && main.includes("Why: derived from your location: Pune, India"));
    const stepNames = await page.locator('section[aria-label="Progress"] [data-step-title]').allInnerTexts();
    check("the story shows the steps, all done, ending in Submitted", ["You swiped right", "Rules checked", "Application form read", "Answers prepared", "Form filled in", "Submitted"].every((s) => stepNames.join("|").includes(s)) && (await page.locator('section[aria-label="Progress"] li[data-step="end"]').count()) === 1);
    check("the confirmation appears under the Submitted step", main.includes('Confirmation: text "Thank you for applying"'));
    check("a submitted application has no problem callout", (await page.locator('section[aria-label="Where this stands"]').count()) === 0);
    check("the trust panel says nothing was made up", main.includes("Nothing here was made up"));
    // The design shows the screenshot in its browser frame straight away, with a full-size link.
    const shotImg = page.locator('img[alt="The filled application form"]');
    await shotImg.scrollIntoViewIfNeeded();
    await shotImg.waitFor({ state: "visible", timeout: 10000 });
    check("a full-size link opens the screenshot", (await page.getByRole("link", { name: "View full size" }).getAttribute("href")) === `/api/files/screenshots/${sent.id}/1.png`);
    const served = await page.evaluate(async (key) => { const r = await fetch(`/api/files/${key}`); return { status: r.status, type: r.headers.get("content-type") }; }, `screenshots/${sent.id}/1.png`);
    check("the screenshot file is served to its owner as an image", served.status === 200 && served.type === "image/png", `${served.status} ${served.type}`);
    await page.waitForFunction(() => { const img = document.querySelector('img[alt="The filled application form"]') as HTMLImageElement | null; return Boolean(img && img.complete && img.naturalWidth > 0); }, undefined, { timeout: 15000 }).then(
      () => check("the screenshot shows and loads", true),
      () => check("the screenshot shows and loads", false),
    );
    check("technical details are collapsed by default", !(await page.getByText("swipe_right: swipe_right passed").isVisible().catch(() => false)));

    // ---------- detail: failed
    await page.goto(`${BASE}/applications/${failedApp.id}`, { timeout: 90000 });
    const callout = page.locator('section[aria-label="Where this stands"]');
    await callout.waitFor({ timeout: 30000 });
    await page.screenshot({ path: `${OUT}/detail-failed.png`, fullPage: true });
    const calloutText = await callout.innerText();
    check("a failed application explains itself with a next step", /The form rejected some answers/.test(calloutText) && /Update those answers, then retry/.test(calloutText), calloutText.replace(/\s+/g, " ").slice(0, 110));
    check("the callout carries the Retry action", await callout.getByRole("button", { name: "Retry" }).isVisible());
    check("the timeline marks where it stopped", (await page.getByText("stopped here").count()) === 1);
    await page.getByText("Technical details").click();
    check("technical details show the raw error when opened", await page.getByText("Raw error: Greenhouse rejected the form: Phone, Email").isVisible());

    // ---------- detail: blocked and running
    await page.goto(`${BASE}/applications/${blockedApp.id}`, { timeout: 90000 });
    await page.locator('section[aria-label="Where this stands"]').waitFor({ timeout: 30000 });
    check("a blocked application names the rule in plain words", /Match too low/.test(await page.locator('section[aria-label="Where this stands"]').innerText()));
    await page.goto(`${BASE}/applications/${running.id}`, { timeout: 90000 });
    await page.getByText("in progress").first().waitFor({ timeout: 30000 });
    check("a running application shows its current step and a Cancel action", (await page.getByText("in progress").count()) >= 1 && (await page.getByRole("button", { name: "Cancel" }).isVisible()));

    // ---------- empty and loading states
    await db.application.updateMany({ where: { id: { in: ids } }, data: { status: "cancelled" } });
    void cancelledApp;
  } catch (error) {
    failed += 1;
    console.log("FAIL", error instanceof Error ? error.message.split("\n")[0] : error);
  } finally {
    await db.$executeRaw`DELETE FROM "FileBlob" WHERE "key" LIKE ${"screenshots/%"} AND "key" = ANY(${ids.map((id) => `screenshots/${id}/1.png`)})`;
    await db.applicationEvent.deleteMany({ where: { applicationId: { in: ids } } });
    await db.application.deleteMany({ where: { id: { in: ids } } });
    await db.session.deleteMany({ where: { id: session.id } });
    await browser.close();
    await db.$disconnect();
  }
  console.log(`screenshots in ${OUT}`);
  console.log(failed === 0 ? "PASS applications" : `FAIL applications (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
