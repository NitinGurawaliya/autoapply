// K18 (docs/hirist/TASKS.md#k18): Hirist's sign-in steps, offline, against a page laid out like Hirist's login.
//
// npx tsx scripts/hirist-otp-test.ts
//   No Hirist, no proxy: a local Chromium opens a page served at Hirist's own address (routed, nothing leaves this
//   machine) with the controls the K18 probe read on 27 Nov: the header's "Login", a modal with input[name=otpIdentifier]
//   and "Get OTP" (disabled until the box holds a mobile number or an email), then the code boxes, and Hirist's own
//   session check (gladiator.hirist.tech/auth/validate: 401 signed out, 200 signed in). The code boxes' layout is a guess
//   until a real code is sent (the owner's connect, K18 Done), so both likely layouts are exercised: one box, a box a digit.
//   Made-up numbers and codes only; the real login is never opened.
import { chromium } from "playwright";
import { enterLoginCode, sendLoginCode, waitForSignIn } from "../src/modules/apply/sites/hirist";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const RIGHT_CODE = "123456";

// A page like Hirist's: header Login opens a modal; Get OTP stays disabled until the id is valid; "0000000000" is unknown to
// "Hirist"; the right code signs in and the page's own session check answers 200 from then on.
const PAGE = (layout: "single" | "boxes") => `<!doctype html><html><body>
<header><button id="cookie">Got it</button><button id="open">Login</button><button>Login as Recruiter</button><input name="query" placeholder="Search Jobs"></header>
<div id="modal" role="dialog" style="display:none">
  <div id="idform"><input name="otpIdentifier" placeholder="Email or Mobile Number"><button id="send" disabled>Get OTP</button><button>Continue with Google</button><p id="err" class="Mui-error"></p></div>
  <div id="codeform" style="display:none">${layout === "single" ? '<input name="otp" type="text" inputmode="numeric">' : [1, 2, 3, 4, 5, 6].map(() => '<input name="d" type="tel" maxlength="1">').join("")}<button id="verify">Verify</button><p id="cerr" class="Mui-error"></p></div>
</div>
<script>
  const q = (s) => document.querySelector(s);
  fetch("https://gladiator.hirist.tech/auth/validate").catch(() => {});
  q("#cookie").onclick = () => q("#cookie").remove();
  q("#open").onclick = () => { q("#modal").style.display = "block"; };
  const id = q("input[name=otpIdentifier]");
  id.oninput = () => { q("#send").disabled = !(/^\\d{10}$/.test(id.value) || /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(id.value)); };
  q("#send").onclick = () => {
    if (id.value === "0000000000") { q("#err").textContent = "No account found for this number"; return; }
    q("#idform").style.display = "none"; q("#codeform").style.display = "block";
  };
  const check = () => {
    const code = [...document.querySelectorAll("#codeform input")].map((i) => i.value).join("");
    if (code.length < 6) return;
    if (code === "${RIGHT_CODE}") { q("#modal").style.display = "none"; fetch("https://gladiator.hirist.tech/auth/validate"); }
    else q("#cerr").textContent = "Invalid OTP, please try again";
  };
  document.querySelectorAll("#codeform input").forEach((input, index, all) => {
    input.oninput = () => { if (input.value && all[index + 1] && all.length > 1) all[index + 1].focus(); if (all.length > 1 && index === all.length - 1) check(); };
  });
  q("#verify").onclick = check;
</script></body></html>`;

async function session(layout: "single" | "boxes") {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  let signedIn = false;
  await context.route("https://www.hirist.tech/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: PAGE(layout) }));
  // The page's own session check: 401 until the right code has been entered, then 200 with the account's name.
  await context.route("https://gladiator.hirist.tech/auth/validate", (route) => {
    if (!signedIn) return route.fulfill({ status: 401, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ error: { statusCode: 401 } }) });
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ data: { firstName: "Asha", email: "asha@example.test" } }) });
  });
  const page = await context.newPage();
  await page.goto("https://www.hirist.tech/", { waitUntil: "domcontentloaded" });
  return { browser, page, signIn: () => (signedIn = true) };
}

async function run(layout: "single" | "boxes") {
  const { browser, page, signIn } = await session(layout);
  try {
    const bad = await sendLoginCode(page, "abc");
    check(`${layout}: an id that is neither a mobile number nor an email is refused before anything is typed`, bad.state === "refused", JSON.stringify(bad));
    const unknown = await sendLoginCode(page, "0000000000");
    check(`${layout}: Hirist's own refusal of an unknown id comes back in its words, without digits`, unknown.state === "refused" && unknown.message.includes("No account found") && !/\d/.test(unknown.message), JSON.stringify(unknown));
    const sent = await sendLoginCode(page, layout === "single" ? "asha@example.test" : "9876543210");
    check(`${layout}: ${layout === "single" ? "an email" : "a mobile number"} opens the form, enables Get OTP and gets to the code`, sent.state === "code_sent", JSON.stringify(sent));
    const none = await enterLoginCode(page, "12");
    check(`${layout}: a code that is not four to eight digits is refused`, none.state === "refused");
    const wrong = await enterLoginCode(page, "654321");
    check(`${layout}: a wrong code comes back in Hirist's words, without digits`, wrong.state === "refused" && wrong.message.includes("Invalid OTP") && !/\d/.test(wrong.message), JSON.stringify(wrong));
    // The stub starts answering signed in at the moment the right code is entered.
    signIn();
    const right = await enterLoginCode(page, RIGHT_CODE);
    check(`${layout}: the right code is accepted`, right.state === "accepted", JSON.stringify(right));
    const done = await waitForSignIn(page, 20_000, async () => false);
    check(`${layout}: the sign-in is confirmed by Hirist's own session check, with the first name`, done.status === "signed_in" && done.accountLabel === "Asha", JSON.stringify(done));
  } finally {
    await browser.close();
  }
}

async function others() {
  const { browser, page } = await session("single");
  try {
    const timeout = await waitForSignIn(page, 3_000, async () => false);
    check("signed out, the wait ends at its limit and never reports a sign-in", timeout.status === "timeout", JSON.stringify(timeout));
    const cancelled = await waitForSignIn(page, 20_000, async () => true);
    check("a withdrawn connection ends the wait at once", cancelled.status === "cancelled", JSON.stringify(cancelled));
    await page.close();
    const closed = await waitForSignIn(page, 3_000, async () => false);
    check("a closed window ends the wait", closed.status === "closed", JSON.stringify(closed));
  } finally {
    await browser.close();
  }
}

(async () => {
  await run("single");
  await run("boxes");
  await others();
  console.log(failed === 0 ? "PASS hirist-otp-test" : `FAIL hirist-otp-test (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
