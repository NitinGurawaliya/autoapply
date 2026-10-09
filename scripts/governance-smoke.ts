// Governance page: the rules in plain words, today's counters, what was blocked and why, the latest decisions,
// and isolation between users. Needs `npm run dev`. Uses its own temporary users. npx tsx scripts/governance-smoke.ts
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { db } from "../src/lib/db";
import { describeRules } from "../src/lib/rule-text";
import { deleteAccount } from "../src/modules/account";
import { check as governance, governanceOverview, loadRules } from "../src/modules/governance";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const BASE = "http://localhost:3000";
const stamp = Date.now();

async function makeUser(label: string) {
  const user = await db.user.create({ data: { email: `gov-${label}-${stamp}@swipeapply.local`, name: `Gov ${label}` } });
  await db.profile.create({ data: { userId: user.id, resumeKey: `resumes/${user.id}/resume.pdf`, resumeText: "x", fullName: `Person ${label}`, email: user.email, skills: [], experience: [], education: [], rawJson: {} } });
  const token = randomBytes(16).toString("hex");
  await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 1_800_000) } });
  return { user, token };
}

async function main() {
  const jobs = await db.job.findMany({ where: { source: "greenhouse" }, take: 2, include: { company: true } });
  if (jobs.length < 2) throw new Error("need two greenhouse jobs");
  const [jobA, jobB] = jobs;
  const A = await makeUser("a");
  const B = await makeUser("b");
  const C = await makeUser("c"); // never does anything: the empty states
  const rules = loadRules();

  try {
    const app = (userId: string, jobId: string, status: string, extra: Record<string, unknown> = {}) =>
      db.application.create({ data: { userId, jobId, status, fields: [], pendingQuestions: [], ...extra } as never });
    const ev = (applicationId: string, type: string, message: string, rule?: string, createdAt?: Date) =>
      db.applicationEvent.create({ data: { applicationId, type, message, rule: rule ?? null, ...(createdAt ? { createdAt } : {}) } });

    // A: one submitted, one blocked by a real rule check, one waiting on a question.
    const sent = await app(A.user.id, jobA.id, "submitted", { submittedAt: new Date() });
    await ev(sent.id, "rule_check", "swipe_right passed", "swipe_right");
    await ev(sent.id, "fill", "Filled first_name");
    await ev(sent.id, "submit", "Application submitted");
    const blocked = await app(A.user.id, jobB.id, "blocked", { error: "min_match_score" });
    const decision = await governance("swipe_right", { applicationId: blocked.id, profileExists: true, score: 12 });
    const waiting = await app(A.user.id, jobA.id, "needs_input");
    await ev(waiting.id, "ask_user", "Need 1 answers");
    // An older block from yesterday: listed, but not in today's counters.
    const yesterday = new Date(Date.now() - 26 * 3600_000);
    const old = await app(A.user.id, jobB.id, "blocked", { error: "no_duplicate_role", createdAt: yesterday });
    await ev(old.id, "block", "You already applied to this role", "no_duplicate_role", yesterday);
    // B: events A must never see.
    const theirs = await app(B.user.id, jobA.id, "blocked", { error: "max_in_flight" });
    await ev(theirs.id, "block", "B-SECRET-EVENT", "max_in_flight");

    check("a real rule check blocks a low match and records the rule", !decision.ok && decision.rule === "min_match_score", String(decision.rule));

    // ---- the data
    const o = await governanceOverview(A.user.id);
    check("counters count today's applications, submissions, blocks, questions and checks", o.counters.started === 3 && o.counters.submitted === 1 && o.counters.blocked === 1 && o.counters.asked === 1 && o.counters.checks >= 2, JSON.stringify(o.counters));
    check("the daily cap is the one from the rules", o.counters.cap === rules.max_applications_per_day);
    check("blocks list newest first and include yesterday's", o.blocks.map((b) => b.rule).join(",") === "min_match_score,no_duplicate_role", o.blocks.map((b) => b.rule).join(","));
    check("filled-field events are left out of the decisions", !o.events.some((e) => e.type === "fill"));
    check("events carry the company and role they belong to", o.events.every((e) => e.company.length > 0 && e.title.length > 0) && o.blocks[0].company === jobB.company.name);
    check("another user's events are never included", !JSON.stringify(o).includes("B-SECRET-EVENT"));
    const bOverview = await governanceOverview(B.user.id);
    check("the other user sees only their own", bOverview.blocks.length === 1 && bOverview.blocks[0].message === "B-SECRET-EVENT" && bOverview.counters.started === 1);

    // twenty at most, newest first
    for (let i = 0; i < 25; i += 1) await ev(sent.id, "rule_check", `bulk ${i}`, "start", new Date(Date.now() + 1000 + i * 10));
    const many = await governanceOverview(A.user.id);
    check("the latest decisions are capped at 20, newest first", many.events.length === 20 && many.events[0].message === "bulk 24" && !many.events.some((e) => e.message === "bulk 0"), `${many.events.length}`);

    // ---- rule wording follows the live values
    const text = describeRules({ ...rules, min_match_score: 95, max_applications_per_day: 7 });
    check("rule text reflects the values it is given", text.find((r) => r.id === "min_match_score")?.value === "95%" && text.find((r) => r.id === "max_applications_per_day")?.value === "7 a day");
    check("every rule in the file has a plain-language line", Object.keys(rules).every((key) => text.some((r) => r.id === key)), Object.keys(rules).filter((k) => !text.some((r) => r.id === k)).join(","));

    // ---- the page
    const browser = await chromium.launch();
    try {
      const open = async (token: string) => {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await ctx.addCookies([{ name: "authjs.session-token", value: token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
        const page = await ctx.newPage();
        await page.goto(`${BASE}/governance`, { timeout: 90000 });
        await page.locator('section[aria-label="Today"]').waitFor({ timeout: 30000 });
        return page;
      };
      const page = await open(A.token);
      await page.screenshot({ path: `${process.env.TEMP ?? "."}/governance-page.png`, fullPage: true });
      const stat = async (label: string) => (await page.locator(`[data-stat="${label}"] span`).first().innerText()).trim();
      check("the page shows today's counters", (await stat("Started")) === `3 of ${rules.max_applications_per_day}` && (await stat("Submitted")) === "1" && (await stat("Blocked")) === "1" && (await stat("Questions asked")) === "1");
      check("the page lists every rule with its value", (await page.locator("[data-rule]").count()) === 13 && (await page.locator('[data-rule="min_match_score"]').innerText()).includes(`${rules.min_match_score}%`));
      const blockRow = page.locator('[data-block-rule="min_match_score"]');
      const blockText = await blockRow.innerText();
      check("a block shows the rule, a plain reason, the role and the company", /Match too low/.test(blockText) && /min_match_score/.test(blockText) && blockText.includes(jobB.company.name) && blockText.includes(jobB.title), blockText.replace(/\s+/g, " ").slice(0, 100));
      check("a block links to its application", (await blockRow.locator("a").getAttribute("href")) === `/applications/${blocked.id}`);
      check("the decisions list is capped at 20", (await page.locator("[data-event-type]").count()) === 20);
      check("another user's event text is not on the page", !(await page.locator("main").innerText()).includes("B-SECRET-EVENT"));
      check("the bottom bar has a Governance tab, active here", (await page.locator('nav[aria-label="Main"] a[aria-current="page"]').last().innerText()).includes("Governance"));

      const empty = await open(C.token);
      const emptyText = await empty.locator("main").innerText();
      check("with no activity the page explains instead of showing blanks", /Nothing has been blocked/.test(emptyText) && /Nothing yet/.test(emptyText) && (await empty.locator('[data-stat="Started"] span').first().innerText()).startsWith("0 of"));
    } finally {
      await browser.close();
    }
  } catch (error) {
    failed += 1;
    console.log("FAIL", error instanceof Error ? error.message.split("\n")[0] : error);
  } finally {
    for (const u of [A, B, C]) await deleteAccount(u.user.id).catch(() => undefined);
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS governance" : `FAIL governance (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
