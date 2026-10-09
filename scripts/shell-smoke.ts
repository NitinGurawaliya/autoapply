// App shell: header, navigation on mobile and desktop, live pending badge, account menu, sign out.
// Needs `npm run dev`. Test account and fixtures only. npx tsx scripts/shell-smoke.ts
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { db } from "../src/lib/db";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const BASE = "http://localhost:3000";

async function main() {
  const user = await db.user.findUnique({ where: { email: "t12-check@swipeapply.local" } });
  const other = await db.job.findFirst({ where: { source: "greenhouse" } });
  if (!user || !other) throw new Error("test user or greenhouse job missing");
  const token = randomBytes(16).toString("hex");
  const session = await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 900_000) } });
  const ids: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const app = await db.application.create({
      data: { userId: user.id, jobId: other.id, status: "needs_input", fields: [], pendingQuestions: [{ key: "notice_period", label: "Notice period", type: "text", required: true }] },
    });
    ids.push(app.id);
  }
  const browser = await chromium.launch();
  try {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await mobile.addCookies([{ name: "authjs.session-token", value: token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
    const page = await mobile.newPage();

    for (const [path, tab] of [["/feed", "Feed"], ["/applications", "Applications"], [`/applications/${ids[0]}`, "Applications"]] as const) {
      await page.goto(`${BASE}${path}`, { timeout: 90000 });
      await page.locator('a[aria-label="SwipeApply home"]').waitFor({ timeout: 30000 });
      const mains = await page.locator("main").count();
      const bottom = page.locator('nav[aria-label="Main"]').last();
      const active = await bottom.locator('a[aria-current="page"]').innerText();
      check(`${path.split("/").slice(0, 2).join("/")} uses the shell with one <main> and the right active tab`, mains === 1 && active.includes(tab), `${mains} main, active "${active.split("\n")[0]}"`);
    }

    // Mobile: bottom bar visible, top nav hidden, pending badge shows 2.
    await page.goto(`${BASE}/feed`, { timeout: 90000 });
    await page.locator('a[aria-label="SwipeApply home"]').waitFor();
    const navs = page.locator('nav[aria-label="Main"]');
    const topVisible = await navs.first().isVisible();
    const bottomVisible = await navs.last().isVisible();
    check("mobile shows the bottom tab bar and hides the top nav", bottomVisible && !topVisible);
    const badge = await navs.last().getByText("2", { exact: true }).first().isVisible();
    check("pending badge shows the number waiting", badge);
    check("the input popup is mounted by the shell", await page.getByRole("dialog").isVisible().catch(() => false) || (await page.getByRole("dialog").waitFor({ timeout: 15000 }).then(() => true, () => false)));

    // The badge follows the data without a reload.
    await db.application.updateMany({ where: { id: { in: ids } }, data: { status: "failed" } });
    await page.waitForFunction(() => !document.querySelector("nav[aria-label='Main'] .bg-warning"), undefined, { timeout: 15000 }).then(
      () => check("badge clears on its own when nothing is waiting", true),
      () => check("badge clears on its own when nothing is waiting", false),
    );

    // Account menu and sign out.
    await page.reload({ timeout: 90000 });
    await page.getByRole("button", { name: "Account menu" }).click();
    const menu = page.getByRole("menu");
    check("account menu shows the email and Sign out", (await menu.innerText()).includes("t12-check@swipeapply.local") && (await menu.getByRole("button", { name: "Sign out" }).isVisible()));
    await page.keyboard.press("Escape");
    check("Escape closes the menu", !(await menu.isVisible().catch(() => false)));

    // Desktop: top nav visible, bottom bar hidden.
    const desktop = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await desktop.addCookies([{ name: "authjs.session-token", value: token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
    const wide = await desktop.newPage();
    await wide.goto(`${BASE}/applications`, { timeout: 90000 });
    await wide.locator('a[aria-label="SwipeApply home"]').waitFor();
    const wideNavs = wide.locator('nav[aria-label="Main"]');
    check("desktop shows the top nav and hides the bottom bar", (await wideNavs.first().isVisible()) && !(await wideNavs.last().isVisible()));

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menu").getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/sign-in/, { timeout: 30000 }).then(
      () => check("Sign out returns to the sign-in page", true),
      () => check("Sign out returns to the sign-in page", false, page.url()),
    );
  } catch (error) {
    failed += 1;
    console.log("FAIL", error instanceof Error ? error.message.split("\n")[0] : error);
  } finally {
    await db.applicationEvent.deleteMany({ where: { applicationId: { in: ids } } });
    await db.application.deleteMany({ where: { id: { in: ids } } });
    await db.session.deleteMany({ where: { id: session.id } });
    await browser.close();
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS shell" : `FAIL shell (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
