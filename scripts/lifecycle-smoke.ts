// Cancel and retry: API rules and the buttons in the browser. Needs `npm run dev`.
// Works whether or not a worker is running: a retried fixture may be picked up and run, so the test waits for
// it to settle before changing it. Test account and fixtures only; all removed at the end.
// npx tsx scripts/lifecycle-smoke.ts
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { db } from "../src/lib/db";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const BASE = "http://localhost:3000";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const TERMINAL = ["submitted", "failed", "blocked", "cancelled", "needs_input"];

async function main() {
  const user = await db.user.findUnique({ where: { email: "t12-check@swipeapply.local" } });
  const mock = await db.job.findUnique({ where: { source_externalId: { source: "mock", externalId: "greenhouse" } } });
  const other = await db.job.findFirst({ where: { source: "greenhouse" } });
  if (!user || !mock || !other) throw new Error("test user or jobs missing");
  const stranger = await db.user.create({ data: { email: `lifecycle-${Date.now()}@swipeapply.local`, name: "Stranger" } });
  const token = randomBytes(16).toString("hex");
  const session = await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 1_800_000) } });
  const cookie = `authjs.session-token=${token}`;
  const ids: string[] = [];
  const make = async (jobId: string, status: string, userId = user.id) => {
    const app = await db.application.create({ data: { userId, jobId, status, fields: [], pendingQuestions: [] } });
    ids.push(app.id);
    return app;
  };
  const post = (id: string, action: "cancel" | "retry") => fetch(`${BASE}/api/applications/${id}/${action}`, { method: "POST", headers: { Cookie: cookie } });
  const statusOf = async (id: string) => (await db.application.findUnique({ where: { id } }))?.status ?? "gone";
  const jobStates = async (id: string) =>
    (await db.$queryRaw<Array<{ state: string }>>`SELECT state FROM pgboss.job WHERE name = 'apply' AND data->>'applicationId' = ${id} ORDER BY created_on DESC`).map((row) => row.state);
  // Stop a fixture a worker may be running: cancel it, then wait until it is no longer moving.
  const settle = async (id: string) => {
    await post(id, "cancel");
    for (let i = 0; i < 40; i += 1) {
      if (TERMINAL.includes(await statusOf(id))) return;
      await sleep(1000);
    }
  };

  const leftovers = await db.application.findMany({ where: { userId: user.id, jobId: mock.id }, select: { id: true } });
  await db.applicationEvent.deleteMany({ where: { applicationId: { in: leftovers.map((a) => a.id) } } });
  await db.application.deleteMany({ where: { id: { in: leftovers.map((a) => a.id) } } });

  const browser = await chromium.launch();
  try {
    // ---- API: cancel
    const running = await make(other.id, "filling");
    await db.$executeRaw`INSERT INTO pgboss.job (name, data, state, started_on) VALUES ('apply', ${JSON.stringify({ applicationId: running.id })}::jsonb, 'active', now())`;
    const c1 = await post(running.id, "cancel");
    const afterCancel = await db.application.findUnique({ where: { id: running.id } });
    check("cancel stops a running application", c1.status === 200 && afterCancel?.status === "cancelled" && afterCancel.error === "Cancelled by you", `${c1.status} ${afterCancel?.status}`);
    check("cancel also cancels its queue job", (await jobStates(running.id))[0] === "cancelled");
    check("cancel writes an event", (await db.applicationEvent.count({ where: { applicationId: running.id, type: "cancel" } })) === 1);
    check("cancelling twice is refused", (await post(running.id, "cancel")).status === 409);
    const theirs = await make(other.id, "filling", stranger.id);
    check("another user's application is not found", (await post(theirs.id, "cancel")).status === 404 && (await post(theirs.id, "retry")).status === 404);
    check("an unknown application is not found", (await post("does-not-exist", "cancel")).status === 404);
    const done = await make(other.id, "submitted");
    check("a submitted application cannot be cancelled or retried", (await post(done.id, "cancel")).status === 409 && (await post(done.id, "retry")).status === 409);

    // ---- API: retry (a live worker may start the run at once, so only stable facts are asserted)
    const failedMock = await make(mock.id, "failed");
    await db.application.update({ where: { id: failedMock.id }, data: { attempt: 2, error: "Some failure" } });
    const r1 = await post(failedMock.id, "retry");
    const afterRetry = await db.application.findUnique({ where: { id: failedMock.id } });
    check("retry re-queues a failed application and resets its attempts", r1.status === 200 && afterRetry?.status !== "failed" && (afterRetry?.attempt ?? 9) <= 1 && afterRetry?.error !== "Some failure", `${r1.status} ${afterRetry?.status} attempt ${afterRetry?.attempt}`);
    const states = await jobStates(failedMock.id);
    check("retry puts a job on the queue", states.length >= 1 && states.every((state) => ["created", "active", "completed"].includes(state)), states.join(","));
    check("a retried application cannot be retried again while it runs or after it finished", (await post(failedMock.id, "retry")).status === 409);
    await settle(failedMock.id);
    check("cancelling the retried application stops it", TERMINAL.includes(await statusOf(failedMock.id)), await statusOf(failedMock.id));
    await db.application.update({ where: { id: failedMock.id }, data: { status: "cancelled", error: "Cancelled by you" } });
    check("a cancelled application can be retried", (await post(failedMock.id, "retry")).status === 200);
    await settle(failedMock.id);

    // ---- API: retry runs the same rules as a new swipe
    await db.application.update({ where: { id: failedMock.id }, data: { status: "submitted" } });
    const dupe = await make(mock.id, "failed");
    const blocked = await post(dupe.id, "retry");
    const blockedBody = (await blocked.json()) as { blocked?: string };
    check("retry is blocked by the duplicate rule", blocked.status === 403 && blockedBody.blocked === "no_duplicate_role", `${blocked.status} ${blockedBody.blocked}`);
    check("a blocked retry leaves the application as it was", (await statusOf(dupe.id)) === "failed");
    await db.applicationEvent.deleteMany({ where: { applicationId: dupe.id } });
    await db.application.delete({ where: { id: dupe.id } });

    // ---- UI
    await db.application.updateMany({ where: { id: { in: [failedMock.id, done.id, running.id] } }, data: { status: "failed" } });
    await db.application.update({ where: { id: failedMock.id }, data: { jobId: other.id } }); // frees the mock role for the UI retry
    const ui = await make(mock.id, "filling"); // looks like a running application; no queue job, so no worker touches it
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: "authjs.session-token", value: token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    await page.goto(`${BASE}/applications`, { timeout: 90000 });
    const rowFor = (id: string) => page.locator(`li:has(a[href="/applications/${id}"])`);
    const row = rowFor(ui.id);
    await row.waitFor({ timeout: 30000 });
    check("a running application shows a Cancel button", await row.getByRole("button", { name: "Cancel" }).isVisible());
    check("a failed application shows a Retry button", await rowFor(failedMock.id).getByRole("button", { name: "Retry" }).isVisible());
    await row.getByRole("button", { name: "Cancel" }).click();
    check("cancelling a running application asks first", (await row.getByRole("button", { name: "Yes, cancel" }).isVisible()) && (await row.getByRole("button", { name: "Keep running" }).isVisible()));
    await row.getByRole("button", { name: "Keep running" }).click();
    check("Keep running changes nothing", (await statusOf(ui.id)) === "filling" && (await row.getByRole("button", { name: "Cancel" }).isVisible()));
    await row.getByRole("button", { name: "Cancel" }).click();
    await row.getByRole("button", { name: "Yes, cancel" }).click();
    await row.getByText("Cancelled", { exact: true }).waitFor({ timeout: 25000 }).then(
      () => check("confirming cancels it and the row shows Cancelled", true),
      () => check("confirming cancels it and the row shows Cancelled", false),
    );
    await row.getByRole("button", { name: "Retry" }).click();
    // A live worker may run it straight away, so the row only has to leave "Cancelled".
    await row.getByText("Cancelled", { exact: true }).waitFor({ state: "detached", timeout: 25000 }).then(
      () => check("Retry on the cancelled row puts it back in progress", true),
      () => check("Retry on the cancelled row puts it back in progress", false),
    );
    await page.goto(`${BASE}/applications/${ui.id}`, { timeout: 90000 });
    await page.locator("h1").waitFor({ timeout: 30000 });
    const detailStatus = await statusOf(ui.id);
    const hasAction = (await page.getByRole("button", { name: /^(Cancel|Retry)$/ }).count()) > 0;
    check("the detail page shows the actions that fit the status", hasAction === ["queued", "inspecting", "filling", "needs_input", "failed", "cancelled"].includes(detailStatus), detailStatus);
  } catch (error) {
    failed += 1;
    console.log("FAIL", error instanceof Error ? error.message.split("\n")[0] : error);
  } finally {
    for (const id of ids) await settle(id).catch(() => undefined);
    await db.$executeRaw`DELETE FROM pgboss.job WHERE name = 'apply' AND data->>'applicationId' = ANY(${ids})`;
    await db.$executeRaw`DELETE FROM "SubmitLock" WHERE "holderId" = ANY(${ids})`;
    await db.applicationEvent.deleteMany({ where: { applicationId: { in: ids } } });
    await db.application.deleteMany({ where: { id: { in: ids } } });
    await db.session.deleteMany({ where: { id: session.id } });
    await db.user.delete({ where: { id: stranger.id } }).catch(() => undefined);
    await browser.close();
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS lifecycle" : `FAIL lifecycle (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
