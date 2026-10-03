import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { db } from "../src/lib/db";

async function waitUntil(id: string, targets: string[], seconds = 90) {
  const seen: string[] = [];
  const deadline = Date.now() + seconds * 1000;
  let application = await db.application.findUnique({ where: { id } });
  while (application && Date.now() < deadline) {
    if (seen[seen.length - 1] !== application.status) seen.push(application.status);
    if (targets.includes(application.status)) return { application, seen };
    await new Promise((resolve) => setTimeout(resolve, 1000));
    application = await db.application.findUnique({ where: { id } });
  }
  return { application, seen };
}

async function main() {
  const email = "t12-check@swipeapply.local";
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error("test user missing");
  const mockJob = await db.job.findUnique({
    where: { source_externalId: { source: "mock", externalId: "greenhouse" } },
  });
  if (!mockJob) throw new Error("mock job missing");

  await db.answer.deleteMany({ where: { userId: user.id, key: "notice_period" } });
  const old = await db.application.findMany({ where: { userId: user.id, jobId: mockJob.id }, select: { id: true } });
  await db.applicationEvent.deleteMany({ where: { applicationId: { in: old.map((row) => row.id) } } });
  await db.application.deleteMany({ where: { userId: user.id, jobId: mockJob.id } });
  await db.swipe.deleteMany({ where: { userId: user.id, jobId: mockJob.id } });

  const sessionToken = randomBytes(16).toString("hex");
  const session = await db.session.create({
    data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 60 * 60 * 1000) },
  });
  const headers = {
    "Content-Type": "application/json",
    Cookie: `authjs.session-token=${sessionToken}`,
  };

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([
    {
      name: "authjs.session-token",
      value: sessionToken,
      url: "http://localhost:3000",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();

  try {
    const first = await fetch("http://localhost:3000/api/swipes", {
      method: "POST",
      headers,
      body: JSON.stringify({ jobId: mockJob.id, direction: "right" }),
    });
    const firstBody = (await first.json()) as { applicationId: string };
    const paused = await waitUntil(firstBody.applicationId, ["needs_input", "submitted", "failed", "blocked"]);
    console.log("first statuses", paused.seen.join(" -> "), "paused", paused.application?.status);
    if (paused.application?.status !== "needs_input") throw new Error("run did not pause");

    await page.goto(`http://localhost:3000/applications/${firstBody.applicationId}`, { timeout: 60000 });
    await page.getByRole("dialog").getByText("Notice period").waitFor({ timeout: 20000 });
    console.log("application page asked");

    await page.goto("http://localhost:3000/feed", { timeout: 60000 });
    await page.getByRole("dialog").getByText("Notice period").waitFor({ timeout: 20000 });
    await page.locator("#answer-notice_period").fill("45");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 20000 }).catch(() => undefined);

    const done = await waitUntil(firstBody.applicationId, ["submitted", "failed", "blocked"]);
    const answer = await db.answer.findUnique({
      where: { userId_key: { userId: user.id, key: "notice_period" } },
    });
    console.log("after answer", done.seen.join(" -> "), "saved source", answer?.source);
    if (done.application?.status !== "submitted") throw new Error(`first run ${done.application?.status} ${done.application?.error}`);
    if (answer?.answer !== "45" || answer.source !== "user") throw new Error("answer was not saved");

    await db.applicationEvent.deleteMany({ where: { applicationId: firstBody.applicationId } });
    await db.application.delete({ where: { id: firstBody.applicationId } });
    await db.swipe.deleteMany({ where: { userId: user.id, jobId: mockJob.id } });

    const second = await fetch("http://localhost:3000/api/swipes", {
      method: "POST",
      headers,
      body: JSON.stringify({ jobId: mockJob.id, direction: "right" }),
    });
    const secondBody = (await second.json()) as { applicationId: string };
    const again = await waitUntil(secondBody.applicationId, ["submitted", "failed", "blocked"]);
    const asked = await db.applicationEvent.count({
      where: { applicationId: secondBody.applicationId, type: "ask_user" },
    });
    console.log("second statuses", again.seen.join(" -> "), "ask_user", asked);
    if (again.seen.includes("needs_input") || asked > 0 || again.application?.status !== "submitted") {
      throw new Error("second run asked again");
    }
    console.log("PASS needs input then silent second run");
  } finally {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    await db.$disconnect();
    await browser.close();
  }
}

main();
