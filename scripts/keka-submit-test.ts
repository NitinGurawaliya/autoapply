// Keka's Apply Now step (3 Nov) on a copy of its form served at a made-up keka.com address, so nothing is ever sent:
// 1) the red box at the top (its duplicate check) and 2) a field's message alone ("Email already exists") each end the
// run at once with Keka's words and a screenshot, never waiting on a person; 3) "Invalid captcha" ends the run as a
// CaptchaRejectedError at once, which the runner reruns from the form (runner.ts; the count is in submit-guard-test.ts);
// 4) on a real Keka form, its own validation messages are read (no Apply pressed).
// Uses the real CAPTCHA reader (OpenAI) on a drawn image. Takes under a minute.
// npx tsx scripts/keka-submit-test.ts
import { chromium, type Page } from "playwright";
import { CaptchaRejectedError, RefusedError, type SubmitContext } from "../src/modules/apply/adapter";
import { formErrors, kekaAdapter } from "../src/modules/apply/adapters/keka";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` (${detail})` : ""}`);
}

const BASE = "https://qa-copy.keka.com/careers";
// Keka's markup for these parts (read from a live form, 2 Nov), with the page's behaviour reduced to the two cases.
const form = (mode: string) => `<!doctype html><html><body>
<form id="jobApplicationForm">
  <div id="validation-error" class="mb-20" style="display:none"><div class="alert alert-danger"><p id="validation-text" class="mb-0" style="display:none"></p></div></div>
  <p id="resume-error" class="text-red" style="display:none">Please upload the resume</p>
  <div class="form-group"><label for="email">Email <span class="ml-1 text-danger">*</span></label><input id="email" name="email" value="someone@example.test"></div>
  <img id="imgCaptcha" width="160" height="50"><input id="captcha" class="form-control">
  <div id="invalidCaptcha" class="error-message" style="display:none">Invalid captcha</div>
  <div id="noCaptcha" class="error-message" style="display:none">Please enter the captcha</div>
  <button type="button" id="jobApplicationSubmitButton">Apply Now</button>
</form>
<script>
  let image = 0;
  function draw() {
    const words = ["7V3CK", "QM4TP"];
    const c = document.createElement("canvas"); c.width = 160; c.height = 50;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 160, 50); g.fillStyle = "#123"; g.font = "bold 30px sans-serif"; g.fillText(words[image++ % 2], 18, 36);
    document.getElementById("imgCaptcha").src = c.toDataURL();
  }
  draw();
  document.getElementById("jobApplicationSubmitButton").addEventListener("click", async () => {
    if (${JSON.stringify(mode)} === "duplicate" || ${JSON.stringify(mode)} === "field") {
      if (${JSON.stringify(mode)} === "duplicate") {
        document.getElementById("validation-error").style.display = "block";
        const text = document.getElementById("validation-text"); text.style.display = "block"; text.textContent = "A candidate with this email has already applied for this job.";
      }
      const label = document.createElement("label"); label.id = "email-error"; label.className = "error"; label.setAttribute("for", "email"); label.textContent = "Email already exists";
      document.getElementById("email").after(label);
      return;
    }
    const response = await fetch(location.pathname, { method: "POST", body: document.getElementById("captcha").value });
    const result = await response.json();
    if (result.success) location.href = "/careers/success/1";
    else { draw(); document.getElementById("invalidCaptcha").style.display = "block"; }
  });
</script></body></html>`;

async function run(page: Page, mode: string) {
  const told: string[] = [];
  let posts = 0;
  await page.route(`${BASE}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      posts += 1;
      // The first answer is always refused, as Keka does for a misread CAPTCHA.
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(posts === 1 ? { invalidCaptcha: true } : { success: true }) });
    }
    if (/\/success\//.test(request.url())) return route.fulfill({ contentType: "text/html", body: "<h1>Application Submitted</h1>" });
    return route.fulfill({ contentType: "text/html", body: form(mode) });
  });
  await page.goto(`${BASE}/applyjob/1`);
  const ctx: SubmitContext = { handoff: true, requestCode: async () => null, announceHandoff: async (message) => void told.push(message), cancelled: async () => false };
  const started = Date.now();
  try {
    const result = await kekaAdapter.submit(page, ctx);
    return { result, error: null as unknown, told, posts, seconds: Math.round((Date.now() - started) / 1000) };
  } catch (error) {
    return { result: null, error, told, posts, seconds: Math.round((Date.now() - started) / 1000) };
  }
}

async function main() {
  const browser = await chromium.launch();
  try {
    // 1. Keka's duplicate check, the red box at the top.
    const dup = await run(await (await browser.newContext()).newPage(), "duplicate");
    const reason = dup.error instanceof Error ? dup.error.message : String(dup.error);
    check("the duplicate check ends the run as refused, nothing sent", dup.error instanceof RefusedError && !(dup.error instanceof CaptchaRejectedError) && dup.posts === 0, `${reason} posts=${dup.posts}`);
    check("its reason is Keka's red box and the field's message, once punctuated", /already applied for this job \| (Email: )?Email already exists\.$/.test(reason), reason);
    check("it stops at once", dup.seconds < 20, `${dup.seconds}s`);
    check("the failure carries a screenshot of the form as Keka showed it", dup.error instanceof RefusedError && (dup.error.screenshot?.length ?? 0) > 1000);

    // 2. A field's message alone: also at once, no waiting on a person.
    const field = await run(await (await browser.newContext()).newPage(), "field");
    check("a field's message ends the run at once with it", field.error instanceof RefusedError && /Email already exists/.test(field.error.message) && field.seconds < 20, `${field.error instanceof Error ? field.error.message : field.error} ${field.seconds}s`);
    check("nobody is asked to fix anything in the window", field.told.length === 0 && dup.told.length === 0, [...dup.told, ...field.told].join(" // "));

    // 3. "Invalid captcha": the run ends at once for a rerun from the form, nothing sent.
    const wrong = await run(await (await browser.newContext()).newPage(), "captcha");
    check("an invalid CAPTCHA ends the run as CaptchaRejectedError, for a rerun from the form", wrong.error instanceof CaptchaRejectedError && wrong.posts === 1 && wrong.seconds < 20, `${wrong.error instanceof Error ? `${wrong.error.name}: ${wrong.error.message}` : JSON.stringify(wrong.result)} posts=${wrong.posts} ${wrong.seconds}s`);
    check("with a screenshot", wrong.error instanceof CaptchaRejectedError && (wrong.error.screenshot?.length ?? 0) > 1000);

    // 4. A real Keka form: its own validation run on the empty form (nothing is pressed, nothing sent).
    const page = await (await browser.newContext()).newPage();
    await page.goto("https://toddle.keka.com/careers/applyjob/10972", { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(() => (window as unknown as { jQuery: (s: string) => { valid(): boolean } }).jQuery("#jobApplicationForm").valid());
    const real = await formErrors(page);
    check("a real Keka form's validation messages are read, with their field", real.length > 0 && real.some((line) => /required/i.test(line) && line.includes(":")), JSON.stringify(real));
    await page.evaluate(() => {
      document.getElementById("validation-error")!.style.display = "block";
      const text = document.getElementById("validation-text")!;
      text.style.display = "block";
      text.textContent = "You have already applied for this job.";
    });
    const top = await formErrors(page);
    check("the red box at the top of a real form is read", top[0] === "You have already applied for this job.", JSON.stringify(top));
  } finally {
    await browser.close();
  }
  console.log(failed === 0 ? "PASS keka-submit" : `FAIL keka-submit (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
