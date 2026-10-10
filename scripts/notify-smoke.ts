// Notifications when the user is needed: browser notification once per prompt, tab-title badge, opt in and out,
// and the optional email webhook. Needs `npm run dev`. Test account and fixtures only.
// npx tsx scripts/notify-smoke.ts
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { db } from "../src/lib/db";
import { notifyNeedsInput } from "../src/lib/notify";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const BASE = "http://localhost:3000";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Headless Chrome cannot show OS notifications, so a stand-in records what would have been shown.
const FAKE_NOTIFICATION = `
  window.__notes = [];
  class FakeNotification {
    constructor(title, options) { this.title = title; this.body = (options || {}).body || ""; window.__notes.push({ title, body: this.body, tag: (options || {}).tag }); }
    close() {}
    static requestPermission() { return Promise.resolve("granted"); }
  }
  FakeNotification.permission = "granted";
  window.Notification = FakeNotification;
`;

async function main() {
  const user = await db.user.findUnique({ where: { email: "t12-check@swipeapply.local" } });
  const other = await db.job.findFirst({ where: { source: "greenhouse" }, include: { company: true } });
  if (!user || !other) throw new Error("test user or greenhouse job missing");
  const company = other.company.name;
  const token = randomBytes(16).toString("hex");
  const session = await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 1_800_000) } });
  const ids: string[] = [];
  const makeWaiting = async (code = false) => {
    const app = await db.application.create({
      data: {
        userId: user.id, jobId: other.id, status: "needs_input", fields: [],
        pendingQuestions: [code ? { key: "security_code", label: "Enter the code", type: "text", required: true } : { key: "notice_period", label: "Notice period", type: "text", required: true }],
      },
    });
    ids.push(app.id);
    await db.applicationEvent.create({ data: { applicationId: app.id, type: "ask_user", message: "Waiting" } });
    return app;
  };
  const notes = (page: import("playwright").Page) => page.evaluate(() => (window as unknown as { __notes: Array<{ title: string; body: string }> }).__notes);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: "authjs.session-token", value: token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
    await context.addInitScript(FAKE_NOTIFICATION);
    const page = await context.newPage();
    await page.goto(`${BASE}/applications`, { timeout: 90000 });
    // The switch lives in the profile menu (the design has no bell in the top bar).
    async function toggle() {
      const menu = page.getByRole("menu");
      if (!(await menu.isVisible().catch(() => false))) await page.getByRole("button", { name: "Your profile and sign out" }).click();
      return menu.locator("button[aria-pressed]");
    }
    const bell = await toggle();
    await bell.waitFor({ timeout: 30000 });
    const baseTitle = (await page.title()).replace(/^\(\d+\)\s*/, "");

    // Opting in
    check("the notifications switch starts off", (await bell.getAttribute("aria-pressed")) === "false");
    await bell.click();
    check("clicking the switch turns notifications on", (await bell.getAttribute("aria-pressed")) === "true");

    // A waiting application: one notification naming the company, and the title badge
    const first = await makeWaiting(false);
    await page.waitForFunction(() => (window as unknown as { __notes: unknown[] }).__notes.length >= 1, undefined, { timeout: 20000 }).catch(() => undefined);
    let list = await notes(page);
    check("a waiting application triggers one notification that names the company", list.length === 1 && list[0].title.includes(company) && /needs an answer/.test(list[0].title), JSON.stringify(list.map((n) => n.title)));
    check("the tab title shows how many are waiting", (await page.title()).startsWith("(1) "), await page.title());

    // No repeats while it stays waiting
    await sleep(9000);
    list = await notes(page);
    check("polling does not repeat the notification", list.length === 1, `${list.length} shown`);

    // And none after a reload (the prompt was already notified)
    await page.reload({ timeout: 90000 });
    await page.locator('nav[aria-label="Main"]').waitFor({ timeout: 30000 });
    await sleep(9000);
    list = await notes(page);
    check("a reload does not notify again for the same prompt", list.length === 0, `${list.length} shown`);

    // A new prompt on the same application (the code screen) notifies again, with different wording
    await db.application.update({ where: { id: first.id }, data: { pendingQuestions: [{ key: "security_code", label: "Enter the code", type: "text", required: true }] } });
    await db.applicationEvent.create({ data: { applicationId: first.id, type: "ask_user", message: "Waiting for the emailed security code" } });
    await page.waitForFunction(() => (window as unknown as { __notes: unknown[] }).__notes.length >= 1, undefined, { timeout: 20000 }).catch(() => undefined);
    list = await notes(page);
    check("a new prompt notifies again, asking for the security code", list.length === 1 && /security code/.test(list[0].title) && list[0].title.includes(company), JSON.stringify(list.map((n) => n.title)));

    // Done waiting: the badge goes away
    await db.application.update({ where: { id: first.id }, data: { status: "failed", pendingQuestions: [] } });
    await page.waitForFunction((base) => document.title === base, baseTitle, { timeout: 15000 }).then(
      () => check("the title badge clears when nothing is waiting", true),
      () => check("the title badge clears when nothing is waiting", false),
    );

    // Opting out: no notification, but the badge still shows
    const again = await toggle();
    await again.click();
    check("clicking the switch again turns notifications off", (await again.getAttribute("aria-pressed")) === "false");
    const before = (await notes(page)).length;
    await makeWaiting(false);
    await sleep(9000);
    list = await notes(page);
    check("with notifications off no new notification is shown", list.length === before, `${list.length - before} new`);
    check("the title badge still works with notifications off", (await page.title()).startsWith("(1) "), await page.title());
  } catch (error) {
    failed += 1;
    console.log("FAIL", error instanceof Error ? error.message.split("\n")[0] : error);
  }

  // ---- email webhook
  try {
    const received: Array<{ auth: string | undefined; body: { to: string; subject: string; text: string } }> = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        received.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
        res.statusCode = 200;
        res.end("ok");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/hook`;

    const app = await makeWaiting(true);
    delete process.env.NOTIFY_WEBHOOK_URL;
    check("email is off unless a webhook is configured", (await notifyNeedsInput(app.id, "code")) === false && received.length === 0);
    process.env.NOTIFY_WEBHOOK_URL = url;
    process.env.NOTIFY_WEBHOOK_SECRET = "test-secret";
    process.env.APP_URL = "https://app.example.test";
    const sentCode = await notifyNeedsInput(app.id, "code");
    const sentAnswers = await notifyNeedsInput(app.id, "answers");
    check("with a webhook configured both kinds are sent", sentCode && sentAnswers && received.length === 2, `${received.length} received`);
    const [c, a] = received;
    check("the email goes to the user and names the company and role", c?.body.to === user.email && c.body.subject.includes(company) && c.body.text.includes(other.title), c?.body.subject);
    check("the code email asks for the security code and the other asks for an answer", /security code/.test(c?.body.subject ?? "") && /needs an answer/.test(a?.body.subject ?? ""));
    check("the link points at the application", c?.body.text.includes(`https://app.example.test/applications/${app.id}`));
    check("the webhook call is authenticated", c?.auth === "Bearer test-secret");
    server.close();
    process.env.NOTIFY_WEBHOOK_URL = "http://127.0.0.1:9/unreachable";
    check("a dead webhook never throws", (await notifyNeedsInput(app.id, "code")) === false);
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
  console.log(failed === 0 ? "PASS notify" : `FAIL notify (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
