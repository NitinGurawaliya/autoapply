// Feed card, drag overlays, filter sheet and empty states, at 390 px. Needs `npm run dev`.
// Test account only; the swipe and refill calls are intercepted, so nothing is queued or sent.
// npx tsx scripts/feed-smoke.ts [screenshotDir]
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { db } from "../src/lib/db";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const BASE = "http://localhost:3000";
const OUT = process.argv[2] ?? `${process.env.TEMP ?? "."}/swipeapply-feed`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const user = await db.user.findUnique({ where: { email: "t12-check@swipeapply.local" } });
  if (!user) throw new Error("test user missing");
  const token = randomBytes(16).toString("hex");
  const session = await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 1_800_000) } });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: "authjs.session-token", value: token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    // Nothing from this test may reach the queue.
    await page.route("**/api/swipes", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
    await page.route("**/api/jobs**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobs: [] }) }));

    await page.goto(`${BASE}/feed`, { timeout: 90000 });
    const card = page.locator("article[data-job-id]").first();
    await card.waitFor({ timeout: 30000 });
    await page.screenshot({ path: `${OUT}/feed.png` });

    // ---- card contents
    const text = await card.innerText();
    check("the card shows role, company, a posted line and why it fits", (await card.locator("h2").innerText()).length > 0 && /\bPosted\b/.test(text) && /WHY IT FITS/i.test(text), text.split("\n").slice(0, 3).join(" | "));
    check("the card shows a company tile with initials", /^[A-Z?]{1,2}$/.test((await card.locator("[data-company-mark]").first().innerText()).trim()));
    const ring = await card.locator('[role="img"]').getAttribute("aria-label");
    check("the match badge has a readable label", /^Match score \d+ percent$/.test(ring ?? ""), String(ring));
    check("the card shows its place tag and the View job link", (await card.locator("span.rounded-full").count()) >= 1 && (await card.getByRole("link", { name: /View job/ }).isVisible()));

    // ---- drag overlays
    const box = (await card.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const stampOpacity = (label: string) => card.getByText(label, { exact: true }).evaluate((el) => Number(getComputedStyle(el).opacity));
    check("stamps are hidden at rest", (await stampOpacity("APPLY")) === 0 && (await stampOpacity("SKIP")) === 0);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 90, cy, { steps: 8 });
    const applyShown = await stampOpacity("APPLY");
    check("dragging right shows the green APPLY stamp", applyShown > 0.3 && (await stampOpacity("SKIP")) === 0, `opacity ${applyShown.toFixed(2)}`);
    await page.screenshot({ path: `${OUT}/feed-drag-apply.png` });
    await page.mouse.move(cx - 90, cy, { steps: 12 });
    const skipShown = await stampOpacity("SKIP");
    check("dragging left shows the grey SKIP stamp", skipShown > 0.3 && (await stampOpacity("APPLY")) === 0, `opacity ${skipShown.toFixed(2)}`);
    await page.mouse.move(cx, cy, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    check("a short drag springs back and does not swipe", (await card.getAttribute("data-job-id")) === (await page.locator("article[data-job-id]").first().getAttribute("data-job-id")) && (await stampOpacity("APPLY")) < 0.05);

    // ---- filter sheet
    check("filters are not on the page until the sheet opens", (await page.locator('a[href^="/feed?"]').count()) === 0);
    await page.getByRole("button", { name: /Filters/ }).click();
    const sheet = page.getByRole("dialog", { name: "Filters" });
    await sheet.waitFor({ timeout: 10000 });
    const sheetText = await sheet.innerText();
    check("the sheet groups filters under plain headings", ["LOCATION", "EXPERIENCE THEY ASK FOR", "POSTED"].every((h) => sheetText.toUpperCase().includes(h)));
    await page.screenshot({ path: `${OUT}/feed-filters.png` });
    await sheet.getByRole("link", { name: "Last 7 days" }).click();
    await page.waitForURL(/days=7/, { timeout: 30000 });
    await page.locator("article[data-job-id], h1:has-text('No jobs match')").first().waitFor({ timeout: 30000 });
    const filtersButton = page.getByRole("button", { name: /Filters/ });
    check("the Filters button counts active filters", (await filtersButton.innerText()).includes("1") && /1 on/.test((await filtersButton.getAttribute("aria-label")) ?? ""));
    await filtersButton.click();
    await page.getByRole("dialog", { name: "Filters" }).getByRole("link", { name: "Reset" }).click();
    await page.waitForURL((url) => url.pathname === "/feed" && url.search === "", { timeout: 30000 });
    check("Reset clears the filters", ((await page.getByRole("button", { name: /Filters/ }).getAttribute("aria-label")) ?? "") === "Filters");

    // ---- empty states
    await page.locator("article[data-job-id]").first().waitFor({ timeout: 30000 });
    let guard = 0;
    while ((await page.locator("article[data-job-id]").count()) > 0 && guard < 80) {
      await page.getByRole("button", { name: "Skip" }).click();
      await page.waitForTimeout(320); // the card is thrown off screen before the next one takes its place
      guard += 1;
    }
    await page.getByText("You're all caught up").waitFor({ timeout: 10000 }).then(
      () => check("running out of cards shows a friendly end state with next steps", true, `${guard} skipped`),
      () => check("running out of cards shows a friendly end state with next steps", false),
    );
    const endLinks = await page.locator("main a").allInnerTexts();
    check(
      "the end state links to applications and offers wider filters",
      endLinks.some((t) => /applications/i.test(t)) && (await page.getByRole("button", { name: "Widen my filters" }).isVisible()),
    );
    await page.screenshot({ path: `${OUT}/feed-empty-deck.png` });

    await context.unroute("**/api/jobs**");
    let emptyFound = false;
    for (const q of ["days=1&country=OTHER&expMax=3", "days=1&country=OTHER", "days=1&country=IN&expMax=3", "days=1&country=REMOTE&expMax=3"]) {
      await page.goto(`${BASE}/feed?${q}`, { timeout: 90000 });
      await page.locator("article[data-job-id], h1:has-text('No jobs match')").first().waitFor({ timeout: 30000 });
      if (await page.getByText("No jobs match these filters").count()) {
        emptyFound = true;
        check(
          "a filter with no results explains and offers a way back",
          (await page.getByRole("link", { name: "Clear all filters" }).isVisible()) && (await page.getByRole("link", { name: /^Remove filter / }).count()) >= 1,
          q,
        );
        await page.screenshot({ path: `${OUT}/feed-empty-filters.png` });
        break;
      }
    }
    if (!emptyFound) console.log("skip no empty-filter query found for the test account; the deck end state above covers the empty case");
  } catch (error) {
    failed += 1;
    console.log("FAIL", error instanceof Error ? error.message.split("\n")[0] : error);
  } finally {
    await db.session.deleteMany({ where: { id: session.id } });
    await browser.close();
    await db.$disconnect();
  }
  console.log(`screenshots in ${OUT}`);
  console.log(failed === 0 ? "PASS feed" : `FAIL feed (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
