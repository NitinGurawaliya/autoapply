// App shell: one two-tab bar (Discover, Applications), live pending badge, the profile menu with the other pages, sign out.
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

    for (const [path, tab] of [["/feed", "Discover"], ["/applications", "Applications"], [`/applications/${ids[0]}`, "Applications"]] as const) {
      await page.goto(`${BASE}${path}`, { timeout: 90000 });
      await page.locator('nav[aria-label="Main"]').waitFor({ timeout: 30000 });
      const mains = await page.locator("main").count();
      const navs = await page.locator('nav[aria-label="Main"]').count();
      const active = await page.locator('nav[aria-label="Main"] a[aria-current="page"]').innerText();
      check(`${path.split("/").slice(0, 2).join("/")} uses the shell with one <main>, one tab bar and the right active tab`, mains === 1 && navs === 1 && active.includes(tab), `${mains} main, ${navs} nav, active "${active.split("\n")[0]}"`);
    }

    // Two tabs only (the design): Discover and Applications. The pending badge shows 2.
    await page.goto(`${BASE}/feed`, { timeout: 90000 });
    const nav = page.locator('nav[aria-label="Main"]');
    await nav.waitFor();
    const tabs = await nav.locator("a").allInnerTexts();
    check("the tab bar has exactly Discover and Applications", tabs.length === 2 && tabs[0].includes("Discover") && tabs[1].includes("Applications"), tabs.map((t) => t.split("\n").pop()).join(", "));
    const badge = nav.locator("[data-pending-badge]");
    await badge.waitFor({ timeout: 15000 }).catch(() => undefined);
    check("pending badge shows the number waiting", (await badge.innerText().catch(() => "")) === "2");
    check("the input popup is mounted by the shell", await page.getByRole("dialog").isVisible().catch(() => false) || (await page.getByRole("dialog").waitFor({ timeout: 15000 }).then(() => true, () => false)));

    // The badge follows the data without a reload.
    await db.application.updateMany({ where: { id: { in: ids } }, data: { status: "failed" } });
    await page.waitForFunction(() => !document.querySelector("nav[aria-label='Main'] [data-pending-badge]"), undefined, { timeout: 15000 }).then(
      () => check("badge clears on its own when nothing is waiting", true),
      () => check("badge clears on its own when nothing is waiting", false),
    );

    // Profile menu: the pages that are not tabs, notifications, sign out.
    await page.reload({ timeout: 90000 });
    await page.getByRole("button", { name: "Your profile and sign out" }).click();
    const menu = page.getByRole("menu");
    const menuText = await menu.innerText();
    check("profile menu shows the email and Sign out", menuText.includes("t12-check@swipeapply.local") && (await menu.getByRole("button", { name: "Sign out" }).isVisible()));
    const links = ["Saved answers", "Fill your gaps", "Governance", "Account and data"];
    check("profile menu links Saved answers, Fill your gaps, Governance, Account and data", links.every((label) => menuText.includes(label)));
    await page.keyboard.press("Escape");
    check("Escape closes the menu", !(await menu.isVisible().catch(() => false)));
    await page.getByRole("button", { name: "Your profile and sign out" }).click();
    await page.getByRole("menuitem", { name: "Saved answers" }).click();
    await page.waitForURL(/\/answers$/, { timeout: 30000 }).then(
      () => check("Saved answers opens from the profile menu", true),
      () => check("Saved answers opens from the profile menu", false, page.url()),
    );

    // Desktop: the same phone column and tab bar, centred.
    const desktop = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await desktop.addCookies([{ name: "authjs.session-token", value: token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
    const wide = await desktop.newPage();
    await wide.goto(`${BASE}/applications`, { timeout: 90000 });
    const wideNav = wide.locator('nav[aria-label="Main"]');
    await wideNav.waitFor();
    const box = await wideNav.boundingBox();
    check("desktop keeps the tab bar in a centred 480 px column", !!box && box.width <= 480 && Math.abs(box.x + box.width / 2 - 600) < 2, box ? `${box.width} wide at x ${box.x}` : "no box");

    await page.getByRole("button", { name: "Your profile and sign out" }).click();
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
