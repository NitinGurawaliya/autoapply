// Going back and forth between tabs reuses pages kept in the browser for a minute (experimental.staleTimes) and the
// server's per-user feed (lib/feed-cache.ts); a swiped card never comes back; a save makes the next visit fresh
// (lib/forget-pages.ts). Run it against a production build: the dev server never keeps pages in the browser, so the
// "no rebuild" checks fail there by design.
//   npm run build && npx next start -p 3100, then BASE_URL=http://localhost:3100 npx tsx scripts/navigation-cache-smoke.ts
// A throwaway test user with mock jobs; nothing is queued or submitted (only left swipes); everything is removed.
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { db } from "../src/lib/db";
import { deleteAccount } from "../src/modules/account";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const stamp = Date.now();

async function main() {
  const user = await db.user.create({ data: { email: `navcache-${stamp}@swipeapply.local`, name: "Nav Cache" } });
  await db.profile.create({ data: { userId: user.id, isTest: true, resumeKey: "x", resumeText: "x", fullName: "Nav Cache", email: user.email, currentTitle: "Software Engineer", yearsExperience: 1, skills: ["React"], experience: [], education: [], rawJson: {} } });
  const company = await db.company.create({ data: { source: "mock", slug: `navcache-${stamp}`, name: "Cache Co", active: false } });
  for (let i = 0; i < 8; i += 1) {
    await db.job.create({ data: { source: "mock", externalId: `navcache-${stamp}-${i}`, companyId: company.id, title: `Software Engineer ${i + 1}`, location: "Remote", country: "REMOTE", remoteType: "remote", description: "React. 0-2 years of experience.", applyUrl: `${BASE}/mock/greenhouse`, postedAt: new Date(), fetchedAt: new Date(), raw: {} } });
  }
  const token = randomBytes(16).toString("hex");
  await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 1_800_000) } });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: "authjs.session-token", value: token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    // Server renders of the feed page during client navigation (React Server Component requests).
    const feedRenders: number[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      // Prefetches (next-router-prefetch) are Next.js warming its cache, not a rebuild for a navigation.
      if (url.pathname === "/feed" && request.headers()["rsc"] && !request.headers()["next-router-prefetch"]) {
        feedRenders.push(Date.now());
        if (process.env.DEBUG_NAV) console.log("     RSC", url.search.slice(0, 40), Object.keys(request.headers()).filter((h) => h.startsWith("next-")).join(","));
      }
    });
    // The top card's title, whatever job it is: real jobs share the feed with the fixtures and can rank above them
    // (16 Oct, Ashby in the feed), so the fixtures' "Software Engineer N" is no longer always on top.
    const topCard = () => page.locator("main h2.type-display-xl").first().innerText();
    // Clicked as an event: in dev, the Next.js indicator sits over the Discover tab at 390 px.
    const tab = (name: string) => ({ click: () => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: new RegExp(`^${name}`) }).dispatchEvent("click") });

    await page.goto(`${BASE}/feed`, { timeout: 90000 });
    await page.getByRole("button", { name: "Skip" }).waitFor({ timeout: 60000 });
    const firstCard = await topCard();
    await page.getByRole("button", { name: "Skip" }).click();
    await page.waitForTimeout(1500);
    const afterSwipe = await topCard();
    check("a left swipe moves to the next card", afterSwipe !== firstCard, `${firstCard} -> ${afterSwipe}`);

    // The first visit was a full page load; one round trip through the app puts the feed in the browser's cache.
    await tab("Applications").click();
    await page.waitForURL("**/applications", { timeout: 30000 });
    await page.waitForTimeout(1500);
    const t1 = Date.now();
    await tab("Discover").click();
    await page.waitForURL("**/feed", { timeout: 30000 });
    await page.getByRole("button", { name: "Skip" }).waitFor({ timeout: 30000 });
    console.log(`     first return to the feed: ${Date.now() - t1} ms (server feed cache)`);
    await tab("Applications").click();
    await page.waitForURL("**/applications", { timeout: 30000 });
    await page.waitForTimeout(1500);
    const before = feedRenders.length;
    const t0 = Date.now();
    await tab("Discover").click();
    await page.waitForURL("**/feed", { timeout: 30000 });
    await page.getByRole("button", { name: "Skip" }).waitFor({ timeout: 30000 });
    const backMs = Date.now() - t0;
    check("coming back to the feed within a minute does not rebuild it on the server", feedRenders.length === before, `${feedRenders.length - before} renders, ${backMs} ms`);
    const shownAgain = await topCard();
    check("the card swiped before leaving does not come back", shownAgain !== firstCard, shownAgain);

    // A save drops the kept pages: saving an answer (the page's own Save) makes the next visit to the feed fresh.
    const push = (path: string) => page.evaluate((to) => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(to), path);
    await push("/answers");
    await page.waitForURL("**/answers", { timeout: 30000 });
    await page.getByRole("button", { name: "Add an answer" }).click();
    await page.locator("#add-key").selectOption("how_heard");
    await page.locator("#add-value").fill("LinkedIn");
    await page.getByRole("button", { name: "Save answer" }).click();
    await page.getByText("Saved").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(4000);
    const beforeSave = feedRenders.length;
    await push("/feed");
    await page.waitForURL("**/feed", { timeout: 30000 });
    await page.getByRole("button", { name: "Skip" }).waitFor({ timeout: 30000 });
    check("after a save, the next visit to the feed is fresh", feedRenders.length > beforeSave, `${feedRenders.length - beforeSave} renders`);

    await page.goto(`${BASE}/feed`, { timeout: 90000 });
    await page.getByRole("button", { name: "Skip" }).waitFor({ timeout: 60000 });
    check("a fresh load of the feed still skips the swiped card (the server excludes it)", (await topCard()) !== firstCard);
  } finally {
    await browser.close();
    await deleteAccount(user.id).catch(() => undefined);
    await db.job.deleteMany({ where: { companyId: company.id } });
    await db.company.delete({ where: { id: company.id } });
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS navigation-cache" : `FAIL navigation-cache (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
