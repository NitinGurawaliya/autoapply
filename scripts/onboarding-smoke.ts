// Onboarding in a real browser at 390 px, as a fresh user: upload and reading, what we found, the two question
// screens. Reading a real resume calls the model, so only the upload's answer is stood in for (and the profile it
// would have made is created); everything after it uses the real saves. Checks that the answers saved are today's
// keys and values. Needs `npm run dev`. npx tsx scripts/onboarding-smoke.ts [outDir]
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { db } from "../src/lib/db";
import { deleteAccount } from "../src/modules/account";

const OUT = process.argv[2] ?? `${process.env.TEMP ?? "."}/swipeapply-onboarding`;
const BASE = "http://localhost:3000";
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const user = await db.user.create({ data: { email: `onb-${randomBytes(4).toString("hex")}@swipeapply.local`, name: "Aarav Kumar" } });
  const token = randomBytes(16).toString("hex");
  await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 900_000) } });
  const browser = await chromium.launch();
  try {
    for (const scheme of ["light", "dark"] as const) {
      await db.answer.deleteMany({ where: { userId: user.id } });
      await db.profile.deleteMany({ where: { userId: user.id } });
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
      await context.addCookies([{ name: "authjs.session-token", value: token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
      const page = await context.newPage();

      // ---- step 1: upload and reading
      await page.goto(`${BASE}/feed`, { timeout: 90000 });
      await page.waitForURL(/\/onboarding\/resume/, { timeout: 30000 });
      await page.getByRole("heading", { name: "Start with your resume" }).waitFor({ timeout: 30000 });
      check(`${scheme}: a new user lands on step 1 of 3`, (await page.getByText("1 of 3").isVisible()) && (await page.getByRole("button", { name: "Read my resume" }).isDisabled()));
      await page.screenshot({ path: `${OUT}/${scheme}-1-upload.png` });
      await page.locator("#resume").setInputFiles({ name: "Aarav_Kumar_Resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
      check(`${scheme}: the chosen file shows with Replace`, (await page.getByText("Aarav_Kumar_Resume.pdf").isVisible()) && (await page.getByRole("button", { name: "Replace" }).isVisible()));
      let uploads = 0;
      await page.route("**/api/profile/resume", async (route) => {
        uploads += 1;
        await db.profile.create({
          data: {
            userId: user.id,
            isTest: true,
            resumeKey: "test",
            resumeText: "",
            fullName: "Aarav Kumar",
            email: user.email,
            phone: null,
            city: "Bengaluru",
            yearsExperience: 3,
            currentTitle: "Backend Engineer",
            currentCompany: "Finch Labs",
            skills: ["Go", "Postgres", "Kafka", "Docker", "Kubernetes"],
            experience: [{ title: "Backend Engineer", company: "Finch Labs", start: "Jun 2022", end: null, summary: null }],
            education: [{ school: "Example University", degree: "B.Tech, Computer Science", year: "2022" }],
            rawJson: {},
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, usedFallback: false }) });
      });
      await page.getByRole("button", { name: "Read my resume" }).click();
      await page.getByRole("heading", { name: "Reading your resume" }).waitFor({ timeout: 5000 });
      await page.screenshot({ path: `${OUT}/${scheme}-2-reading.png` });
      await page.getByRole("button", { name: "Check what we found" }).waitFor({ timeout: 20000 });
      const found = await page.locator("body").innerText();
      check(
        `${scheme}: the reading screen lists what was found and the missing phone`,
        uploads === 1 && found.includes("Aarav Kumar") && found.includes("3 years across 1 role") && /Phone\s+Not found/.test(found),
        found.replace(/\s+/g, " ").slice(0, 160),
      );
      await page.screenshot({ path: `${OUT}/${scheme}-3-got-it.png` });
      await page.getByRole("button", { name: "Check what we found" }).click();

      // ---- step 2: what we found
      await page.getByRole("heading", { name: "Here's what we found" }).waitFor({ timeout: 30000 });
      check(`${scheme}: step 2 shows the missing-phone card`, await page.getByText("We couldn't find your phone number").isVisible());
      await page.screenshot({ path: `${OUT}/${scheme}-4-found.png` });
      await page.locator("#phone-missing").fill("9845012345");
      await page.getByRole("button", { name: "Edit city" }).click();
      await page.locator("#city").fill("Pune");
      await page.getByRole("button", { name: "Done" }).click();
      await page.getByRole("button", { name: "Looks right" }).click();
      await page.waitForURL(/\/onboarding\/questions/, { timeout: 30000 });
      const profile = await db.profile.findUnique({ where: { userId: user.id } });
      check(`${scheme}: Looks right saves the profile, then moves on`, profile?.phone === "9845012345" && profile?.city === "Pune", `${profile?.phone} ${profile?.city}`);

      // ---- step 3: two question screens
      await page.getByRole("heading", { name: "A few answers every form asks" }).waitFor({ timeout: 30000 });
      await page.getByRole("button", { name: "Next", exact: true }).click();
      check(`${scheme}: an unanswered screen is refused`, await page.getByText("Answer every question before moving on.").isVisible());
      await page.locator("#current_ctc").fill("12.5");
      await page.locator("#expected_ctc").fill("18");
      await page.getByRole("button", { name: "30 days" }).click();
      await page.screenshot({ path: `${OUT}/${scheme}-5-money.png` });
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByRole("heading", { name: "What are you looking for?" }).waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "Full-time" }).click();
      // "India" is both a place to work (first) and the citizenship chip (second, in Country questions).
      await page.getByRole("button", { name: "India", exact: true }).first().click();
      await page.getByRole("button", { name: "US", exact: true }).click();
      check(`${scheme}: the country questions are asked once, for everyone`, await page.getByText("Country questions").isVisible());
      await page.getByRole("button", { name: "India", exact: true }).nth(1).click();
      await page.getByRole("button", { name: "No, only jobs where I live" }).click();
      await page.getByRole("button", { name: "No", exact: true }).click();
      await page.screenshot({ path: `${OUT}/${scheme}-6-where.png` });
      await page.getByRole("button", { name: /Start swiping/ }).click();
      await page.waitForURL(/\/feed/, { timeout: 60000 });
      const rows = await db.answer.findMany({ where: { userId: user.id } });
      const answers = Object.fromEntries(rows.map((row) => [row.key, `${row.answer}|${row.source}`]));
      const expected: Record<string, string> = {
        current_ctc: "12.5|user",
        expected_ctc: "18|user",
        notice_period: "30|user",
        employment_type: "Full-time|user",
        preferred_location: "India,US|user",
        citizenship: "India|user",
        relocate_outside_home: "No, only jobs where I live|user",
        sponsorship_outside_home: "No|user",
      };
      check(`${scheme}: the saved answers use today's keys and values`, Object.entries(expected).every(([key, value]) => answers[key] === value), JSON.stringify(answers));
      await context.close();
    }
  } catch (error) {
    failed += 1;
    console.log("FAIL", error instanceof Error ? error.message.split("\n")[0] : error);
  } finally {
    await browser.close();
    await deleteAccount(user.id).catch(() => undefined);
    await db.$disconnect();
  }
  console.log(`screenshots in ${OUT}`);
  console.log(failed === 0 ? "PASS onboarding" : `FAIL onboarding (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
