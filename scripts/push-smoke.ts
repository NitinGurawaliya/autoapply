// Browser push end to end (lib/push.ts, public/sw.js, components/notifications.tsx, modules/jobs/warm.ts), as the test
// account in a real Chromium: notifications on through the app's own code → the subscription is saved → a push from the
// server is shown by the service worker → the new-match alert finds new Strong / Good jobs and is shown too. Needs
// `npm run dev`. Everything it creates (session, subscription) is removed. npx tsx scripts/push-smoke.ts
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { db } from "../src/lib/db";
import { sendPush } from "../src/lib/push";
import { listFeed, parseFeedFilters } from "../src/modules/jobs";
import { alertNewMatches } from "../src/modules/jobs/warm";

const BASE = "http://localhost:3000";
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const user = await db.user.findUnique({ where: { email: "t12-check@swipeapply.local" }, select: { id: true, matchesAlertedAt: true } });
  if (!user) throw new Error("test user missing");
  const token = randomBytes(16).toString("hex");
  await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 1_800_000) } });
  const before = new Set((await db.pushSubscription.findMany({ where: { userId: user.id }, select: { id: true } })).map((row) => row.id));
  // A normal (persistent) profile in installed Chrome: browsers refuse push in incognito-like contexts, and Chrome
  // delivers through Google's push service as it would for a real user.
  const dir = mkdtempSync(join(tmpdir(), "swipeapply-push-"));
  const context = await chromium.launchPersistentContext(dir, { channel: "chrome", headless: false, viewport: { width: 390, height: 844 }, permissions: ["notifications"] });
  try {
    await context.addCookies([{ name: "authjs.session-token", value: token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    await page.route("**/api/swipes", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
    await page.goto(`${BASE}/feed`, { timeout: 90000 });
    // The same switch the profile menu flips: opt in, then the app's notifier subscribes this browser.
    await page.evaluate(() => localStorage.setItem("swipeapply:notify", "1"));
    await page.reload({ timeout: 90000 });

    let saved = null;
    for (let i = 0; i < 30 && !saved; i += 1) {
      await wait(1000);
      saved = await db.pushSubscription.findFirst({ where: { userId: user.id, id: { notIn: [...before] } } });
    }
    check("turning notifications on saves this browser's push subscription", !!saved, saved ? new URL(saved.endpoint).host : "none after 30 s");
    if (!saved) return;

    const shown = async (title: string) => {
      for (let i = 0; i < 20; i += 1) {
        await wait(1000);
        const titles = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((note) => note.title));
        if (titles.some((text) => text.includes(title))) return true;
      }
      return false;
    };
    const sent = await sendPush(user.id, { title: "SwipeApply push test", body: "If you see this, push works.", url: "/feed", tag: "push-test" });
    check("the server's push is accepted by the push service", sent >= 1, `sent to ${sent}`);
    check("the service worker shows it", await shown("SwipeApply push test"));

    // New-match alert: everything in the feed counts as new when the last alert was long ago.
    await db.user.update({ where: { id: user.id }, data: { matchesAlertedAt: new Date(Date.now() - 90 * 864e5) } });
    const feed = await listFeed(user.id, parseFeedFilters({}));
    const good = feed.filter((job) => job.tier === "strong" || job.tier === "good").length;
    const alerted = await alertNewMatches(user.id, feed);
    check("the new-match alert is sent when the feed has new Strong / Good jobs", good === 0 ? !alerted : alerted, `${good} strong/good in the feed`);
    if (alerted) check("and shown", await shown("match your resume") || await shown("matches your resume"));
    const again = await alertNewMatches(user.id, feed);
    check("the same jobs are not alerted twice", !again);

    await page.evaluate(async () => {
      const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      await subscription?.unsubscribe();
    });
  } finally {
    await context.close();
    rmSync(dir, { recursive: true, force: true });
    await db.pushSubscription.deleteMany({ where: { userId: user.id, id: { notIn: [...before] } } });
    await db.user.update({ where: { id: user.id }, data: { matchesAlertedAt: user.matchesAlertedAt } });
    await db.session.deleteMany({ where: { sessionToken: token } });
  }
  console.log(failed === 0 ? "PASS push" : `FAIL push (${failed})`);
  process.exitCode = failed === 0 ? 0 : 1;
}
main().finally(() => db.$disconnect());
