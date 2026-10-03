// Security-code handoff without touching Greenhouse: a local page imitates Greenhouse's emailed-code step.
// The "user" answers through the real POST /api/applications/:id/answers route (dev server must be running).
// npx tsx scripts/security-code-smoke.ts
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { db } from "../src/lib/db";
import { waitForGreenhouseConfirmation } from "../src/modules/apply/adapters/greenhouse";
import { codeRequester } from "../src/modules/apply/runner";

const RIGHT = "AB12CD34";
const WRONG = "ZZZZZZZZ";

const FAKE_STEP = `<!doctype html><body>
<p>Enter the 8-character security code we emailed you.</p>
<div id="boxes">${Array.from({ length: 8 }, (_, i) => `<input id="security-input-${i}" maxlength="1" aria-label="Security code ${i + 1}">`).join("")}</div>
<p id="err"></p><button type="button" id="go">Submit application</button>
<script>
document.getElementById("go").onclick = () => {
  const code = Array.from(document.querySelectorAll("[id^=security-input-]")).map((i) => i.value).join("");
  setTimeout(() => {
    if (code === "${RIGHT}") document.body.innerHTML = "<h1>Thank you for applying.</h1>";
    else document.getElementById("err").textContent = "Incorrect security code";
  }, 500);
};
</script></body>`;

async function waitForPending(id: string) {
  for (let i = 0; i < 30; i += 1) {
    const app = await db.application.findUnique({ where: { id } });
    const pending = (app?.pendingQuestions ?? []) as Array<{ key: string; label: string }>;
    if (app?.status === "needs_input" && pending[0]?.key === "security_code") return pending[0].label;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("worker never asked for the code");
}

async function main() {
  const user = await db.user.findUnique({ where: { email: "t12-check@swipeapply.local" } });
  const job = await db.job.findUnique({ where: { source_externalId: { source: "mock", externalId: "greenhouse" } } });
  if (!user || !job) throw new Error("test user or mock job missing");
  const app = await db.application.create({
    data: { userId: user.id, jobId: job.id, status: "filling", fields: [], pendingQuestions: [] },
  });
  const sessionToken = randomBytes(16).toString("hex");
  const session = await db.session.create({ data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 600_000) } });
  const answer = (code: string) =>
    fetch(`http://localhost:3000/api/applications/${app.id}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `authjs.session-token=${sessionToken}` },
      body: JSON.stringify({ answers: [{ key: "security_code", answer: code }] }),
    });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(FAKE_STEP);

    const simulateUser = (async () => {
      const first = await waitForPending(app.id);
      console.log(`asked: "${first}"`);
      console.log("wrong code →", (await answer(WRONG)).status);
      const second = await waitForPending(app.id);
      console.log(`asked again: "${second}"`);
      console.log("right code →", (await answer(RIGHT)).status);
    })();
    const [evidence] = await Promise.all([
      waitForGreenhouseConfirmation(page, { requestCode: codeRequester(app.id) }, 20000),
      simulateUser,
    ]);

    const row = await db.application.findUnique({ where: { id: app.id } });
    const events = await db.applicationEvent.findMany({ where: { applicationId: app.id } });
    const leaked = events.some((event) => JSON.stringify(event).includes(RIGHT) || JSON.stringify(event).includes(WRONG));
    const banked = await db.answer.count({ where: { userId: user.id, key: "security_code" } });
    console.log(`evidence: ${evidence}`);
    console.log(`ask_user events: ${events.filter((e) => e.type === "ask_user").length}, code cleared: ${row?.verificationCode == null}, code in events: ${leaked}, code in answer bank: ${banked > 0}`);
    const ok = /after security code/.test(evidence) && row?.verificationCode == null && !leaked && banked === 0;
    console.log(ok ? "PASS security code handoff" : "FAIL security code handoff");
  } catch (error) {
    console.log("FAIL", error instanceof Error ? error.message : error);
  } finally {
    await db.applicationEvent.deleteMany({ where: { applicationId: app.id } });
    await db.application.delete({ where: { id: app.id } });
    await db.session.delete({ where: { id: session.id } });
    await browser.close();
    await db.$disconnect();
  }
}

main();
