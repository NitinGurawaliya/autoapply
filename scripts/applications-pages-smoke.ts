// The applications list loads in pages (finished ones 25 at a time, active ones always) with counts over everything,
// and the detail page re-renders only when its application changes (T73). Needs `npm run dev`. A throwaway test user
// with 52 applications on mock jobs; nothing is queued for the worker; everything is removed at the end.
// npx tsx scripts/applications-pages-smoke.ts
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { db } from "../src/lib/db";
import { deleteAccount } from "../src/modules/account";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const BASE = "http://localhost:3000";
const stamp = Date.now();

async function main() {
  const user = await db.user.create({ data: { email: `pages-${stamp}@swipeapply.local`, name: "Pages" } });
  await db.profile.create({ data: { userId: user.id, isTest: true, resumeKey: "x", resumeText: "x", fullName: "Pages", email: user.email, skills: [], experience: [], education: [], rawJson: {} } });
  const company = await db.company.create({ data: { source: "mock", slug: `pages-${stamp}`, name: "Paging Co", active: false } });
  const token = randomBytes(16).toString("hex");
  await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 1_800_000) } });
  const browser = await chromium.launch();
  try {
    // 40 sent, 10 that did not go through, one waiting in line (no "needs you", so no sheet covers the list).
    const statuses = [...Array(40).fill("submitted"), ...Array(10).fill("failed"), "queued"];
    const jobs = await Promise.all(
      statuses.map((_, i) =>
        db.job.create({ data: { source: "mock", externalId: `pages-${stamp}-${i}`, companyId: company.id, title: `Role ${i + 1}`, location: "Remote", country: "REMOTE", remoteType: "remote", description: "x", applyUrl: `${BASE}/mock/greenhouse`, postedAt: new Date(), fetchedAt: new Date(), raw: {} } }),
      ),
    );
    await db.application.createMany({
      data: statuses.map((status, i) => ({ userId: user.id, jobId: jobs[i].id, status, fields: [], pendingQuestions: [], createdAt: new Date(stamp - (statuses.length - i) * 60_000), submittedAt: status === "submitted" ? new Date() : null })),
    });
    const queued = await db.application.findFirstOrThrow({ where: { userId: user.id, status: "queued" } });

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: "authjs.session-token", value: token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    const rowCount = () => page.locator('section li a[href^="/applications/"]').evaluateAll((links) => new Set(links.map((a) => a.getAttribute("href"))).size);

    // ---------- list
    await page.goto(`${BASE}/applications`, { timeout: 90000 });
    await page.locator("section li").first().waitFor({ timeout: 60000 });
    const chips = await page.locator('[role=group][aria-label=Show] button').allInnerTexts();
    check("the chips count every application, not only the loaded page", chips.map((c) => c.replace(/\s+/g, " ")).join(" | ") === "All 51 | Needs you 0 | In progress 1 | Sent 40 | Didn't go through 10", chips.join(" | "));
    check("the first page has the active one and 25 finished", (await rowCount()) === 26, String(await rowCount()));
    const more = page.getByRole("button", { name: "Show more" });
    check("Show more is offered", await more.isVisible());
    await more.click();
    await page.waitForFunction(() => document.querySelectorAll('section li a[href^="/applications/"]').length >= 51, null, { timeout: 30000 });
    check("Show more loads the rest", (await rowCount()) === 51);
    check("and goes away at the end", !(await page.getByRole("button", { name: "Show more" }).isVisible()));
    await page.waitForTimeout(4000); // one poll (the queued one keeps the list polling)
    check("a poll keeps the pages already loaded", (await rowCount()) === 51, String(await rowCount()));
    await page.locator('[role=group][aria-label=Show] button', { hasText: /^Sent/ }).click();
    // The loaded rows filter at once; the Sent tab's own first page (and its Show more) follows.
    await page.getByRole("button", { name: "Show more" }).waitFor({ timeout: 30000 });
    check("the Sent tab pages its own rows", (await rowCount()) === 25 && (await page.locator("section h2").innerText()).includes("40") && (await page.getByRole("button", { name: "Show more" }).isVisible()), String(await rowCount()));

    // ---------- detail
    const versions: string[] = [];
    const pageLoads: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("only=version")) versions.push(request.url());
      else if (request.url().includes(`/applications/${queued.id}`) && request.headers()["rsc"]) pageLoads.push(request.url());
    });
    await page.goto(`${BASE}/applications/${queued.id}`, { timeout: 90000 });
    await page.getByText(/Getting ready to apply|Up next/).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(7000);
    check("while nothing changes it only checks the version", versions.length >= 2 && pageLoads.length === 0, `${versions.length} version checks, ${pageLoads.length} page renders`);
    await db.application.update({ where: { id: queued.id }, data: { status: "filling" } });
    await db.applicationEvent.create({ data: { applicationId: queued.id, type: "inspect", message: "Found 3 fields" } });
    await page.getByText("Writing your answers").first().waitFor({ timeout: 15000 }).catch(() => undefined);
    check("a change re-renders the page", (await page.getByText("Writing your answers").count()) > 0 && pageLoads.length >= 1, `${pageLoads.length} page renders`);
    await db.application.update({ where: { id: queued.id }, data: { status: "submitted", submittedAt: new Date() } });
    await page.getByText(/^Sent /).first().waitFor({ timeout: 15000 }).catch(() => undefined);
    const after = versions.length;
    await page.waitForTimeout(7000);
    check("once it is finished the checks stop", versions.length === after, `${versions.length - after} more checks`);
  } finally {
    await browser.close();
    await deleteAccount(user.id).catch(() => undefined);
    await db.job.deleteMany({ where: { companyId: company.id } });
    await db.company.delete({ where: { id: company.id } });
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS applications-pages" : `FAIL applications-pages (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
