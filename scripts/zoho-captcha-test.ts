// Zoho Recruit's CAPTCHA, read by the worker (21 Nov), on a copy of its form served at a made-up zohorecruit.in address,
// so nothing is ever sent: the CAPTCHA row as four live portals draw it (`.crc-captcha`, its box, image and "Load new
// CAPTCHA" button), the images drawn on a canvas, Zoho's answer to the POST faked.
//  1) no OpenAI key: the CAPTCHA goes to a person, nothing typed or sent; 2) no window (`!ctx.handoff`): BotCheckError;
//  3) the read is typed and Zoho's 200 confirms it; 4) a blank first image is refreshed, never submitted blank;
//  5) a refusal naming the CAPTCHA (in its words or only in its code) is a CaptchaRejectedError, for the runner's rerun
//  from the form; 6) a wrong CAPTCHA said on the form, not in an answer, too; 7) any other refusal is NotSentError, no
//  rerun; plus the reply and read-cleaning helpers. Uses the real CAPTCHA reader (OpenAI). Takes about a minute.
// npx tsx scripts/zoho-captcha-test.ts
import { chromium, type Browser } from "playwright";
import { loadEnvFile } from "../src/lib/db";
import { BotCheckError, CaptchaRejectedError, NotSentError, WindowClosedError, type SubmitContext } from "../src/modules/apply/adapter";
import { readZohoReply, zohoAdapter } from "../src/modules/apply/adapters/zohorecruit";
import { cleanCaptchaText } from "../src/modules/apply/captcha/ai";
import { inspectZohoCaptcha } from "../src/modules/apply/captcha/detector";

loadEnvFile();

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` (${detail})` : ""}`);
}

const ORIGIN = "https://qa-copy.zohorecruit.in";
const JOB = `${ORIGIN}/jobs/Careers/123/QA-Engineer`;
const POST = `${ORIGIN}/recruit/v2/public/Job_Openings/123/apply/456`;
// Six characters, as every Zoho CAPTCHA read on 21 Nov (the adapter refuses any other length).
const WORDS = ["k7m4pq", "x3hq8z", "w9tb2c", "r5nf6y"];

// mode: "blank" draws a blank first image; "form-error" shows Zoho-like CAPTCHA words on the form and posts nothing.
const form = (mode: string) => `<!doctype html><html><body>
<form id="f" onsubmit="return false">
  <div class="crc-form-row crc-rec-form_1"><label>First Name</label><input name="rec-form_1" value="Test"></div>
  <div class="crc-captcha">
    <lyte-input class="crc-form-textfield crc-captcha"><div class="lyteField"><input type="text" maxlength="10" placeholder="Type below image text" autocomplete="off"></div></lyte-input>
    <div class="crc-captcha-container"><img alt="CAPTCHA"><button type="button" aria-label="Load new CAPTCHA"></button></div>
    <span class="errorMsg" style="display:none">Please enter a valid captcha</span>
  </div>
  <button type="submit">Submit Application</button>
</form>
<script>
  window.drawn = 0; window.word = "";
  function draw() {
    const blank = ${JSON.stringify(mode)} === "blank" && window.drawn === 0;
    window.word = blank ? "" : ${JSON.stringify(WORDS)}[window.drawn % ${WORDS.length}];
    window.drawn += 1;
    const c = document.createElement("canvas"); c.width = 200; c.height = 70;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 200, 70);
    g.fillStyle = "#1d4ed8"; g.font = "bold 36px sans-serif"; g.fillText(window.word, 30, 48);
    document.querySelector(".crc-captcha-container img").src = c.toDataURL();
  }
  draw();
  document.querySelector("[aria-label='Load new CAPTCHA']").addEventListener("click", draw);
  document.querySelector("button[type=submit]").addEventListener("click", async () => {
    const typed = document.querySelector("input[placeholder='Type below image text']").value;
    if (${JSON.stringify(mode)} === "form-error") { document.querySelector(".errorMsg").style.display = "block"; return; }
    const response = await fetch("/recruit/v2/public/Job_Openings/123/apply/456?pagename=Careers", { method: "POST", body: JSON.stringify({ typed, word: window.word }) });
    const body = await response.json();
    if (body.data && body.data[0].code === "SUCCESS") document.body.innerHTML = "<h1>Thank you for applying!</h1>";
    else draw();
  });
</script></body></html>`;

type Reply = (typed: string, word: string, posts: number) => { status: number; body: unknown };
const accept: Reply = (typed, word) =>
  typed.toLowerCase() === word.toLowerCase()
    ? { status: 200, body: { data: [{ code: "SUCCESS", status: "success", message: "Applied successfully" }] } }
    : { status: 200, body: { data: [{ code: "INVALID_DATA", status: "error", message: "Invalid captcha" }] } };

async function run(browser: Browser, mode: string, reply: Reply, ctxOver: Partial<SubmitContext> = {}) {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  const told: string[] = [];
  const typedSent: string[] = [];
  let posts = 0;
  await page.route(`${ORIGIN}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.url().startsWith(POST)) {
      posts += 1;
      const sent = JSON.parse(request.postData() ?? "{}") as { typed: string; word: string };
      typedSent.push(sent.typed);
      const { status, body } = reply(sent.typed, sent.word, posts);
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    }
    return route.fulfill({ contentType: "text/html", body: form(mode) });
  });
  await page.goto(JOB);
  const inspection = await inspectZohoCaptcha(page);
  const ctx: SubmitContext = {
    handoff: true,
    requestCode: async () => null,
    announceHandoff: async (message) => void told.push(message),
    // Once a person is asked, the test ends the wait as a cancel rather than holding 15 minutes.
    cancelled: async () => told.length > 0,
    ...ctxOver,
  };
  const started = Date.now();
  const done = (result: Awaited<ReturnType<typeof zohoAdapter.submit>> | null, error: unknown) => ({ result, error, told, posts, typedSent, inspection, page, seconds: Math.round((Date.now() - started) / 1000) });
  try {
    return done(await zohoAdapter.submit(page, ctx), null);
  } catch (error) {
    return done(null, error);
  }
}

const describe = (error: unknown) => (error instanceof Error ? `${error.constructor.name}: ${error.message}` : JSON.stringify(error));

async function main() {
  // Helpers first (no browser).
  check("a clean read is kept", cleanCaptchaText("k7m4p") === "k7m4p");
  check("quotes, spaces and a lead-in are dropped", cleanCaptchaText('The text is: "k7 m4p".') === "k7m4p", String(cleanCaptchaText('The text is: "k7 m4p".')));
  check("NONE, junk, too short and too long are refused", [cleanCaptchaText("NONE"), cleanCaptchaText("k7-m4p!"), cleanCaptchaText("ab"), cleanCaptchaText("abcdefghijk"), cleanCaptchaText("")].every((value) => value === null));
  // The two misreads of the 21 Nov dry run (koantek "c7gwd" for cn7gwd, sectona "xdlfp8d" for xdfp8d): refused at 6.
  check("a read one character short or long is refused when the length is known", cleanCaptchaText("c7gwd", 6, 6) === null && cleanCaptchaText("xdlfp8d", 6, 6) === null && cleanCaptchaText("cn7gwd", 6, 6) === "cn7gwd");
  const coded = readZohoReply(200, JSON.stringify({ data: [{ code: "INVALID_CAPTCHA", status: "error", message: "Please enter valid data" }] }));
  check("Zoho's error code is kept with a refusal", coded.kind === "refused" && coded.code === "INVALID_CAPTCHA", JSON.stringify(coded));
  const ok = readZohoReply(200, JSON.stringify({ data: [{ code: "SUCCESS", status: "success", message: "Applied" }] }));
  check("a success carries no code", ok.kind === "sent" && ok.code === undefined, JSON.stringify(ok));

  const browser = await chromium.launch();
  try {
    // 1. No OpenAI key: a person gets the CAPTCHA, nothing is typed or sent. First, before the reader's client exists.
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const nokey = await run(browser, "plain", accept);
    process.env.OPENAI_API_KEY = key;
    check("the CAPTCHA row is found (image, box, refresh)", nokey.inspection.board === "zohorecruit" && nokey.inspection.required && nokey.inspection.imageVisible && nokey.inspection.inputVisible && nokey.inspection.refreshAvailable, JSON.stringify(nokey.inspection));
    check("without a key the CAPTCHA goes to a person", nokey.told.some((line) => /reader is not available, so the CAPTCHA is yours to type/.test(line)), nokey.told.join(" // "));
    check("and nothing is sent", nokey.posts === 0 && nokey.error instanceof WindowClosedError, `${describe(nokey.error)} posts=${nokey.posts}`);
    if (!key) throw new Error("OPENAI_API_KEY is not in .env; the rest of the test reads CAPTCHAs with the model");

    // 2. No window for this run: as before, nothing read or sent.
    const nowindow = await run(browser, "plain", accept, { handoff: false });
    check("without a window it is a BotCheckError, nothing sent", nowindow.error instanceof BotCheckError && nowindow.posts === 0, describe(nowindow.error));

    // 3. The read is typed and Zoho's 200 confirms the application.
    const good = await run(browser, "plain", accept);
    check("the agent's read is typed and Submit pressed", good.posts >= 1 && (good.typedSent[0]?.length ?? 0) >= 4, `posts=${good.posts} typed=${JSON.stringify(good.typedSent)}`);
    // Zoho's 200 or the thank-you page that follows it, whichever the loop sees first.
    check("Zoho's 200 confirms it", good.result?.confirmed === true && /answered 200|Thank you for applying/.test(good.result.evidence ?? ""),`${describe(good.error)} ${JSON.stringify(good.result)} typed=${JSON.stringify(good.typedSent)}`);
    check("no person was asked", good.told.length === 0, good.told.join(" // "));

    // 4. A blank first image: refreshed and read again, never submitted blank.
    const blank = await run(browser, "blank", accept);
    const drawn = await blank.page.evaluate(() => (window as unknown as { drawn: number }).drawn).catch(() => 0);
    check("a blank image is refreshed, not read", drawn >= 2, `drawn=${drawn}`);
    check("nothing blank is ever sent", blank.typedSent.every((typed) => typed.length >= 4) && blank.result?.confirmed === true, `${describe(blank.error)} typed=${JSON.stringify(blank.typedSent)}`);

    // 5. Zoho refuses the CAPTCHA: in its words, and in its code alone.
    const refusedWords = await run(browser, "plain", () => ({ status: 200, body: { data: [{ code: "INVALID_DATA", status: "error", message: "Invalid captcha" }] } }));
    check("a refusal naming the CAPTCHA is a CaptchaRejectedError (runner reruns from the form)", refusedWords.error instanceof CaptchaRejectedError && refusedWords.posts === 1 && refusedWords.seconds < 30, `${describe(refusedWords.error)} posts=${refusedWords.posts} ${refusedWords.seconds}s`);
    check("with a screenshot", refusedWords.error instanceof CaptchaRejectedError && (refusedWords.error.screenshot?.length ?? 0) > 1000);
    const refusedCode = await run(browser, "plain", () => ({ status: 400, body: { code: "INVALID_CAPTCHA", status: "error", message: "Please enter valid data" } }));
    check("a CAPTCHA named only in Zoho's code is too", refusedCode.error instanceof CaptchaRejectedError, describe(refusedCode.error));

    // 6. A wrong CAPTCHA said on the form, nothing posted.
    const onForm = await run(browser, "form-error", accept);
    check("a CAPTCHA error on the form is a CaptchaRejectedError, nothing sent", onForm.error instanceof CaptchaRejectedError && onForm.posts === 0 && onForm.seconds < 30, `${describe(onForm.error)} posts=${onForm.posts} ${onForm.seconds}s`);

    // 7. Any other refusal ends the run with Zoho's words, no rerun.
    const other = await run(browser, "plain", () => ({ status: 400, body: { code: "MANDATORY_NOT_FOUND", status: "error", message: "Required field Mobile is missing" } }));
    check("any other refusal is NotSentError with Zoho's words, no rerun", other.error instanceof NotSentError && !(other.error instanceof CaptchaRejectedError) && /Mobile is missing/.test(describe(other.error)), describe(other.error));
  } finally {
    await browser.close();
  }
  console.log(failed === 0 ? "PASS zoho-captcha" : `FAIL zoho-captcha (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("FAIL zoho-captcha", error);
  process.exit(1);
});
