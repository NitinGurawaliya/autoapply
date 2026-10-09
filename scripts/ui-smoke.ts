// UI checks on the test account only: instant swipe, applications list and detail, company name in the question popup.
// Needs `npm run dev` on :3000. No real jobs are touched; every fixture is removed at the end.
// npx tsx scripts/ui-smoke.ts
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { db } from "../src/lib/db";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

async function main() {
  const user = await db.user.findUnique({ where: { email: "t12-check@swipeapply.local" } });
  const mock = await db.job.findUnique({ where: { source_externalId: { source: "mock", externalId: "greenhouse" } }, include: { company: true } });
  if (!user || !mock) throw new Error("test user or mock job missing");

  const sessionToken = randomBytes(16).toString("hex");
  const session = await db.session.create({ data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 900_000) } });
  const fixtureIds: string[] = [];
  const browser = await chromium.launch();
  try {
    const submitted = await db.application.create({
      data: {
        userId: user.id,
        jobId: mock.id,
        status: "submitted",
        submittedAt: new Date(),
        attempt: 1,
        fields: [
          { key: "first_name", label: "First Name", value: "Test", source: "user", selector: "#first_name" },
          { key: "resume", label: "Resume", value: "resume.pdf", source: "resume", selector: "#resume" },
          { key: "gender", label: "Gender", value: "Decline to answer", source: "default", selector: "#gender" },
          { key: "cover_letter", label: "Cover letter", value: "Draft text", source: "ai_draft", selector: "#cl" },
        ],
        pendingQuestions: [],
      },
    });
    await db.applicationEvent.create({ data: { applicationId: submitted.id, type: "submit", message: "Application submitted. Confirmation: text \"Thank you for applying\"" } });
    const asking = await db.application.create({
      data: {
        userId: user.id,
        jobId: mock.id,
        // Starts as failed: a waiting application opens the modal popup, which blocks the pages behind it.
        status: "failed",
        fields: [],
        pendingQuestions: [{ key: "notice_period", label: "Notice period", type: "text", required: true }],
      },
    });
    fixtureIds.push(submitted.id, asking.id);

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: "authjs.session-token", value: sessionToken, url: "http://localhost:3000", httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();

    // 1. Applications list
    await page.goto("http://localhost:3000/applications", { timeout: 90000 });
    await page.getByText("Submitted", { exact: true }).first().waitFor({ timeout: 20000 });
    const listText = await page.locator("main").innerText();
    check("list shows company and role", listText.includes(mock.company.name) && listText.includes(mock.title), mock.company.name);
    await page.getByRole("button", { name: /^Submitted/ }).click();
    const rowsShown = await page.locator("ul li").count();
    const badgesShown = await page.locator("ul li").getByText("Submitted", { exact: true }).count();
    check("Submitted filter shows only submitted", rowsShown >= 1 && badgesShown === rowsShown, `${rowsShown} rows, ${badgesShown} badged Submitted`);

    // 2. Detail
    await page.goto(`http://localhost:3000/applications/${submitted.id}`, { timeout: 90000 });
    await page.getByText("What was filled in").waitFor({ timeout: 20000 });
    const detail = await page.locator("main").innerText();
    check("detail shows each filled field", ["First Name", "Test", "Resume", "resume.pdf", "Decline to answer"].every((t) => detail.includes(t)));
    check("detail shows source badges", ["You", "Resume", "Default", "AI draft"].every((t) => detail.includes(t)));
    check("detail shows confirmation in timeline", detail.includes("Thank you for applying"));

    // 3. Popup names the company
    await db.application.update({ where: { id: asking.id }, data: { status: "needs_input" } });
    await page.goto("http://localhost:3000/feed", { timeout: 90000 });
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 20000 });
    const dialogText = await dialog.innerText();
    check("question popup names the company", dialogText.includes(`${mock.company.name} asks`) && dialogText.includes(mock.title), dialogText.split("\n")[0]);

    // 4. Instant swipe: hold the server's answer for 4 s and check the next card still appears at once.
    // Applied roles are hidden from the feed, so release both fixtures before testing the deck.
    await db.application.updateMany({ where: { id: { in: [asking.id, submitted.id] } }, data: { status: "failed" } });
    await page.reload({ timeout: 90000 });
    const cards = page.locator("article[data-job-id]");
    await cards.first().waitFor({ timeout: 30000 });
    const firstId = await cards.first().getAttribute("data-job-id");
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/swipes", async (route) => {
      await held;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }).catch(() => undefined);
    });
    const t0 = Date.now();
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForFunction((id) => document.querySelector("article[data-job-id]")?.getAttribute("data-job-id") !== id, firstId, { timeout: 3000 }).catch(() => undefined);
    const advancedIn = Date.now() - t0;
    const moved = (await page.locator("article[data-job-id]").first().getAttribute("data-job-id").catch(() => null)) !== firstId;
    check("next job appears before the server answers", moved && advancedIn < 1000, `${advancedIn} ms while the request was held`);
    release();
    await page.waitForTimeout(800);

    // 5. A failed save puts the card back.
    await page.unroute("**/api/swipes");
    await page.route("**/api/swipes", (route) => route.abort());
    const secondId = await page.locator("article[data-job-id]").first().getAttribute("data-job-id");
    await page.getByRole("button", { name: "Skip" }).click();
    await page.waitForFunction((id) => document.querySelector("article[data-job-id]")?.getAttribute("data-job-id") === id, secondId, { timeout: 8000 }).then(
      () => check("failed swipe returns the card", true),
      () => check("failed swipe returns the card", false),
    );
  } catch (error) {
    failed += 1;
    console.log("FAIL", error instanceof Error ? error.message.split("\n")[0] : error);
  } finally {
    await db.applicationEvent.deleteMany({ where: { applicationId: { in: fixtureIds } } });
    await db.application.deleteMany({ where: { id: { in: fixtureIds } } });
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    await browser.close();
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS ui smoke" : `FAIL ui smoke (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
