// Saved-answers page and API: list, edit, delete (with confirmation), add, ownership, and that deleting an answer
// makes the next application ask again. Needs `npm run dev`. Uses its own temporary users.
// npx tsx scripts/answers-smoke.ts
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { db } from "../src/lib/db";
import { customQuestionKey, getAnswerKey } from "../src/modules/answers";
import { deleteAccount } from "../src/modules/account";
import { resolveValues } from "../src/modules/apply";
import type { FormField } from "../src/modules/apply";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const BASE = "http://localhost:3000";
const stamp = Date.now();

async function makeUser(label: string) {
  const user = await db.user.create({ data: { email: `ans-${label}-${stamp}@swipeapply.local`, name: `Ans ${label}` } });
  await db.profile.create({ data: { userId: user.id, resumeKey: `resumes/${user.id}/resume.pdf`, resumeText: "x", fullName: `Person ${label}`, email: user.email, skills: [], experience: [], education: [], rawJson: {} } });
  const token = randomBytes(16).toString("hex");
  await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 1_800_000) } });
  return { user, token, cookie: `authjs.session-token=${token}` };
}

async function main() {
  const A = await makeUser("a");
  const B = await makeUser("b");
  const label = "Why do you want to work here?";
  const qKey = customQuestionKey(label);
  await db.answer.createMany({
    data: [
      { userId: A.user.id, key: "notice_period", question: "Notice period", answer: "30", source: "user" },
      { userId: A.user.id, key: "expected_ctc", question: "Expected CTC", answer: "12", source: "user" },
      { userId: A.user.id, key: "gender", question: "Gender", answer: "Decline to answer", source: "default" },
      { userId: A.user.id, key: "city", question: "City", answer: "Mohali", source: "resume" },
      { userId: A.user.id, key: qKey, question: label, answer: "Because the product is interesting.", source: "user" },
    ],
  });
  const call = (who: { cookie: string } | null, method: string, path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, { method, headers: { ...(who ? { Cookie: who.cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const browser = await chromium.launch();
  try {
    // ---- API rules
    check("signed-out delete is refused", (await call(null, "DELETE", "/api/answers?key=notice_period")).status === 401);
    check("a delete with no key is refused", (await call(A, "DELETE", "/api/answers")).status === 400);
    check("another user cannot delete my answer", (await call(B, "DELETE", "/api/answers?key=notice_period")).status === 404 && (await db.answer.count({ where: { userId: A.user.id, key: "notice_period" } })) === 1);

    // ---- page
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: "authjs.session-token", value: A.token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    await page.goto(`${BASE}/answers`, { timeout: 90000 });
    await page.locator('[data-answer-key="notice_period"]').waitFor({ timeout: 30000 });
    const text = await page.locator("main").innerText();
    check("answers are grouped under plain headings", ["CONTACT", "YOUR ANSWERS", "EQUAL OPPORTUNITY"].every((h) => text.toUpperCase().includes(h)));
    check("a canonical answer shows its plain name and value", text.includes("Notice period (days)") && text.includes("30"));
    check("a question from an application shows the question itself", text.includes(label) && text.includes("Because the product is interesting."));
    check("sensitive answers say they are never written by AI", (await page.getByText("never written by AI").count()) === 2);
    check("each answer shows where it came from", ["You", "Default", "Resume"].every((s) => text.includes(s)));
    check(
      "Saved answers is a profile-menu page: its title shows and neither tab is active",
      (await page.locator("h1").first().innerText()).includes("Saved answers") && (await page.locator('nav[aria-label="Main"] a[aria-current="page"]').count()) === 0,
    );
    await page.screenshot({ path: `${process.env.TEMP ?? "."}/answers-page.png`, fullPage: true });

    // ---- edit
    const row = page.locator('[data-answer-key="notice_period"]');
    await row.getByRole("button", { name: "Edit" }).click();
    const input = row.getByLabel("New value for Notice period (days)");
    check("editing opens the current value", (await input.inputValue()) === "30");
    await input.fill("45");
    await row.getByRole("button", { name: "Save" }).click();
    await page.locator("[data-sonner-toast]").getByText("Saved", { exact: true }).waitFor({ timeout: 15000 }).catch(() => undefined);
    const edited = await db.answer.findUnique({ where: { userId_key: { userId: A.user.id, key: "notice_period" } } });
    check("saving an edit changes it, and it is now yours", edited?.answer === "45" && edited.source === "user", `${edited?.answer}`);
    await row.getByRole("button", { name: "Edit" }).click();
    await row.getByRole("button", { name: "Cancel" }).click();
    check("cancelling an edit changes nothing", (await db.answer.findUnique({ where: { userId_key: { userId: A.user.id, key: "notice_period" } } }))?.answer === "45");

    // ---- delete
    const city = page.locator('[data-answer-key="city"]');
    await city.getByRole("button", { name: "Delete" }).click();
    await city.getByRole("button", { name: "Keep it" }).click();
    check("Keep it leaves the answer", (await db.answer.count({ where: { userId: A.user.id, key: "city" } })) === 1);
    await city.getByRole("button", { name: "Delete" }).click();
    await city.getByRole("button", { name: "Yes, delete" }).click();
    await city.waitFor({ state: "detached", timeout: 15000 }).then(
      () => check("confirming removes the row", true),
      () => check("confirming removes the row", false),
    );
    check("and removes the answer from the database", (await db.answer.count({ where: { userId: A.user.id, key: "city" } })) === 0);

    // ---- the next application asks again
    const field: FormField = { selector: "#city", label: "City", type: "text", required: true };
    const profile = { fullName: "A", email: "a@x", phone: null, city: null, country: null, linkedin: null, github: null, portfolio: null, yearsExperience: null, currentTitle: null, currentCompany: null, resumeKey: "resumes/x/resume.pdf" };
    const rows = await db.answer.findMany({ where: { userId: A.user.id } });
    const after = resolveValues([{ field, key: "city" }], profile, rows);
    check("after a delete the next form asks for it again", after.pending.length === 1 && after.pending[0].key === "city" && after.values.length === 0);
    const asked = await db.answer.findMany({ where: { userId: A.user.id } });
    check("an edited answer is what the next form uses", resolveValues([{ field: { ...field, label: "Notice period" }, key: "notice_period" }], profile, asked).values[0]?.value === "45");

    // ---- add
    await page.getByRole("button", { name: "Add an answer" }).click();
    await page.getByLabel("Which answer").selectOption("willing_to_relocate");
    await page.getByLabel("Your answer", { exact: true }).fill("No");
    await page.getByRole("button", { name: "Save answer" }).click();
    await page.locator('[data-answer-key="willing_to_relocate"]').waitFor({ timeout: 15000 }).then(
      () => check("a new answer appears on the page", true),
      () => check("a new answer appears on the page", false),
    );
    const added = await db.answer.findUnique({ where: { userId_key: { userId: A.user.id, key: "willing_to_relocate" } } });
    check("and is saved as yours under the right key", added?.answer === "No" && added.source === "user" && !!getAnswerKey("willing_to_relocate"));
    check("the add list offers no identity details or resume", await page.getByLabel("Which answer").evaluate((el) => !Array.from((el as HTMLSelectElement).options).some((o) => /first name|email|phone|resume/i.test(o.text))).catch(() => true));

    // ---- user B sees none of it
    const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctxB.addCookies([{ name: "authjs.session-token", value: B.token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
    const pageB = await ctxB.newPage();
    await pageB.goto(`${BASE}/answers`, { timeout: 90000 });
    await pageB.getByText("Nothing saved yet").waitFor({ timeout: 30000 });
    check("another user sees an empty page, not my answers", !(await pageB.locator("main").innerText()).includes("Because the product"));
  } catch (error) {
    failed += 1;
    console.log("FAIL", error instanceof Error ? error.message.split("\n")[0] : error);
  } finally {
    await deleteAccount(A.user.id).catch(() => undefined);
    await deleteAccount(B.user.id).catch(() => undefined);
    await browser.close();
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS answers" : `FAIL answers (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
