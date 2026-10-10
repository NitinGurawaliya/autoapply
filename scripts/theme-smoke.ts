// Theme check in a real browser at 390 px: the brand accent is actually applied, and screenshots are saved for review.
// Needs `npm run dev`. Uses the test account and removes its fixtures. npx tsx scripts/theme-smoke.ts [outDir]
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { db } from "../src/lib/db";

const OUT = process.argv[2] ?? `${process.env.TEMP ?? "."}/swipeapply-theme`;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const BRAND = "rgb(198, 244, 50)"; // --primary #c6f432 (lime)
const PAGE_BG = "rgb(246, 246, 247)"; // --background #f6f6f7

async function main() {
  mkdirSync(OUT, { recursive: true });
  const user = await db.user.findUnique({ where: { email: "t12-check@swipeapply.local" } });
  const mock = await db.job.findUnique({ where: { source_externalId: { source: "mock", externalId: "greenhouse" } } });
  if (!user || !mock) throw new Error("test user or mock job missing");
  // Fixture applications point at a different job so the mock job stays in the feed (applied roles are hidden there).
  const other = await db.job.findFirst({ where: { source: "greenhouse" } });
  if (!other) throw new Error("no greenhouse job for fixtures");
  const token = randomBytes(16).toString("hex");
  const session = await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 900_000) } });
  const ids: string[] = [];
  for (const status of ["submitted", "filling", "needs_input", "failed", "blocked", "cancelled", "queued"]) {
    const app = await db.application.create({
      data: { userId: user.id, jobId: other.id, status, fields: [{ key: "first_name", label: "First Name", value: "Test", source: "user", selector: "#a" }, { key: "gender", label: "Gender", value: "Decline to answer", source: "default", selector: "#b" }], pendingQuestions: [], error: status === "failed" ? "Example failure message" : null, submittedAt: status === "submitted" ? new Date() : null },
    });
    ids.push(app.id);
  }
  const browser = await chromium.launch();
  try {
    // Sign-in, signed out.
    const anon = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await anon.goto("http://localhost:3000/sign-in", { timeout: 90000 });
    await anon.getByRole("button").first().waitFor({ timeout: 30000 });
    await anon.screenshot({ path: `${OUT}/sign-in.png` });
    const signInBg = await anon.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check("page background is the soft brand surface", signInBg === PAGE_BG, signInBg);
    await anon.close();

    // Signed in.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: "authjs.session-token", value: token, url: "http://localhost:3000", httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();

    await page.goto("http://localhost:3000/feed", { timeout: 90000 });
    await page.locator("article[data-job-id]").first().waitFor({ timeout: 30000 });
    const apply = await page.getByRole("button", { name: "Apply" }).evaluate((el) => getComputedStyle(el).backgroundColor);
    check("Apply button uses the brand accent", apply === BRAND, apply);
    await page.getByRole("button", { name: /Filters/ }).click();
    await page.getByRole("dialog", { name: "Filters" }).waitFor({ timeout: 10000 });
    const chip = await page.locator('a[aria-current="true"]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.keyboard.press("Escape");
    check("active filter chip uses the brand accent", chip === BRAND, chip);
    // The article moves; its first child is the card face (white, ink edge, hard ink shadow).
    const card = await page
      .locator("article[data-job-id] > div")
      .first()
      .evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, shadow: getComputedStyle(el).boxShadow, edge: getComputedStyle(el).borderTopColor }));
    check(
      "job card is a white surface with the ink edge and hard shadow",
      card.bg === "rgb(255, 255, 255)" && card.edge === "rgb(22, 23, 26)" && card.shadow.includes("rgb(22, 23, 26) 0px 6px 0px"),
      `${card.bg}, edge ${card.edge}, shadow ${card.shadow}`,
    );
    await page.screenshot({ path: `${OUT}/feed.png` });

    await page.goto("http://localhost:3000/applications", { timeout: 90000 });
    await page.locator('li[data-row="sent"]').first().waitFor({ timeout: 30000 });
    // Status is ink and lime only (design/applications.html): the selected chip is ink, sent rows carry an ink check,
    // didn't-go-through rows are dashed.
    const all = await page.getByRole("group", { name: "Show" }).getByRole("button", { name: /^All/ }).evaluate((el) => getComputedStyle(el).backgroundColor);
    check("the selected filter chip is ink", all === "rgb(22, 23, 26)", all);
    const mark = await page.locator('li[data-row="sent"] [aria-hidden="true"].rounded-full').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    check("a sent row carries the ink check", mark === "rgb(22, 23, 26)", mark);
    const dashed = await page.locator('li[data-row="failed"]').first().evaluate((el) => getComputedStyle(el).borderTopStyle);
    check("a didn't-go-through row is dashed", dashed === "dashed", dashed);
    await page.screenshot({ path: `${OUT}/applications.png`, fullPage: true });

    await page.goto(`http://localhost:3000/applications/${ids[0]}`, { timeout: 90000 });
    await page.locator('section[aria-label="What was filled in"]').waitFor({ timeout: 30000 });
    await page.screenshot({ path: `${OUT}/detail.png`, fullPage: true });

    // Dark mode renders with the dark tokens.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check("dark mode uses the dark surface", darkBg === "rgb(14, 15, 17)", darkBg);
    await page.screenshot({ path: `${OUT}/detail-dark.png`, fullPage: true });
  } catch (error) {
    failed += 1;
    console.log("FAIL", error instanceof Error ? error.message.split("\n")[0] : error);
  } finally {
    await db.applicationEvent.deleteMany({ where: { applicationId: { in: ids } } });
    await db.application.deleteMany({ where: { id: { in: ids } } });
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    await browser.close();
    await db.$disconnect();
  }
  console.log(`screenshots in ${OUT}`);
  console.log(failed === 0 ? "PASS theme" : `FAIL theme (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
