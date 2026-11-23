// The mock Naukri job page and chat drawer (K4b, docs/naukri/TDD.md 11 item 4): what test profiles and automated tests
// apply on instead of Naukri. One source for the app's /mock/naukri (route.ts and its two service routes), the offline
// adapter test (scripts/naukri-adapter-test.ts) and the end-to-end smoke (scripts/naukri-mock-smoke.ts).
//
// The ids and the drawer's markup are copied from Naukri's own code (5 Nov recon: the job page's app/jd/page chunk; the
// drawer's chatbot-workflow-utility/v5 bundle and its templates for botMsg, ssrc__radio, chatbot_Chip, textArea,
// dob__input, sendMsg). Its script stands in for Naukri's: Apply posts to the apply service, each answer to the bot, and
// the drawer's last answer posts the apply again. The adapter (modules/apply/sites/naukriApply.ts) tells the services
// by their paths, so the same code drives the real page and this one.
//
// The flow is the URL's hash: #questions (default), #instant, #refuse, #applied, #company, #signedout.

export const MOCK_NAUKRI_PATH = "/mock/naukri";
export const APPLY_PATH = "/cloudgateway-workflow/workflow-services/apply-workflow/v1/apply";
export const RESPOND_PATH = "/cloudgateway-chatbot/chatbot-services/botapi/v5/respond";

/** The questions the mock asks, one per step, in Naukri's own control kinds. Labels match the answer keys' synonyms. */
export const MOCK_NAUKRI_QUESTIONS = [
  { text: ["Hi, kindly answer the recruiter's questions to apply.", "Are you willing to relocate to Bengaluru?"], kind: "radio", options: ["Yes", "No"] },
  { text: ["What is your current CTC?"], kind: "text" },
  { text: ["What is your notice period?"], kind: "chips", options: ["15 Days or less", "1 Month", "2 Months", "Skip this question"] },
  { text: ["What is your date of birth?"], kind: "dob" },
] as const;

export type MockApplyBody = { strJobsarr?: string[]; applyData?: { answers?: string[] } };

/**
 * The mock apply service: the first press opens the drawer (as Naukri does for a job with questions), the press after
 * the drawer's last answer applies. #instant applies at once.
 */
export function mockApplyReply(body: MockApplyBody, instant = false) {
  const jobId = body.strJobsarr?.[0] ?? "mock";
  if (body.applyData || instant) return { jobs: [{ jobId, status: 200 }] };
  return { jobs: [{ jobId, status: 200 }], chatbotResponse: { speechResponse: [{ type: "text", response: "Hi" }], currentConversationName: "mock" } };
}

export const mockRespondReply = () => ({ speechResponse: [{ type: "text", response: "next" }], options: [] });

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The page. `services`: the origin and prefix the two services live under ("" on the app, naukri.com in tests). */
export function mockNaukriHtml(options: { jobId: string; services: string; title?: string }) {
  const config = JSON.stringify({ jobId: options.jobId, apply: `${options.services}${APPLY_PATH}`, respond: `${options.services}${RESPOND_PATH}`, questions: MOCK_NAUKRI_QUESTIONS }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(options.title ?? "Java Full Stack Developer")} - Bengaluru - Mock Naukri</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;padding:24px;color:#111}
.d-none{display:none}
button{font:inherit;padding:8px 18px;border-radius:20px;border:1px solid #275df5;background:#275df5;color:#fff;cursor:pointer}
.chatbot_Drawer{position:fixed;right:0;top:0;width:min(472px,100%);height:100%;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.1);overflow:auto}
.chatbot_DrawerContentWrapper{display:flex;flex-direction:column;height:100%;padding:16px;box-sizing:border-box}
.chatbot_MessageContainer{flex:1}
.list{list-style:none;padding:0;margin:0}
.botMsg{background:#f1f4fa;border-radius:12px;padding:8px 12px;margin:6px 0;max-width:85%}
.chipMsg{background:#275df5;color:#fff;border-radius:12px;padding:8px 12px;margin:6px 0 6px auto;width:fit-content}
.chatbot_Chip{display:inline-block;border:1px solid #275df5;border-radius:16px;padding:6px 12px;margin:4px;cursor:pointer}
.textArea{border:1px solid #ccc;border-radius:8px;min-height:24px;padding:8px}
.dob__input{width:64px;margin-right:6px}
.sendMsg{display:inline-block;margin-top:12px;padding:8px 18px;border-radius:20px;background:#275df5;color:#fff;cursor:pointer}
</style>
</head>
<body>
<header><a id="login_Layer" class="nI-gNb-lg-rg__login d-none">Login</a></header>
<main>
  <p>Mock Naukri, for test profiles and automated tests. Nothing here reaches Naukri or an employer.</p>
  <h1>${escape(options.title ?? "Java Full Stack Developer")}</h1>
  <div id="buttons"></div>
</main>
<script>
const CONFIG = ${config};
const flow = location.hash.slice(1) || "questions";
const buttons = document.getElementById("buttons");
const markApplied = () => { buttons.innerHTML = '<span id="already-applied" class="already-applied">Applied</span>'; };
if (flow === "signedout") document.getElementById("login_Layer").classList.remove("d-none");
if (flow === "applied") markApplied();
else if (flow === "company") buttons.innerHTML = '<button id="company-site-button" class="company-site-button">Apply on company site</button>';
else buttons.innerHTML = '<button id="apply-button" class="apply-button">Apply</button>';

const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const QUESTIONS = CONFIG.questions;
let step = 0;
let id = 0;
const answers = [];
const list = () => document.querySelector("ul[id^='chatList_']");
const footer = () => document.getElementById("footer");

function openDrawer() {
  const drawer = document.createElement("div");
  drawer.className = "chatbot_Drawer chatbot_right";
  drawer.innerHTML = "<div class='chatbot_DrawerContentWrapper'><div class='chatbot_MessageContainer' id='msgs'><ul class='list' id='chatList_1'></ul><div id='footer'></div></div>" +
    "<div id='sendMsgbtn_container_2' class='sendMsgbtn_container'><div id='sendMsg_2' class='send'><div class='sendMsg' tabindex='0'>Save</div></div></div></div>";
  document.body.appendChild(drawer);
  drawer.querySelector(".sendMsg").addEventListener("click", save);
}

function say(cls, html) {
  const li = document.createElement("li");
  li.className = cls + " chatbot_ListItem";
  li.innerHTML = html;
  list().appendChild(li);
}
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
const botSays = (texts) => texts.forEach((text) => say("botItem", "<div class='botMsg msg '><div><span>" + esc(text) + "</span></div></div>"));
const userSays = (text) => say("userItem", "<div class='chipMsg'><span>" + esc(text) + "</span></div>");

function render(question) {
  botSays(question.text);
  id += 1;
  let html = "";
  if (question.kind === "radio") {
    html = "<div class='singleselect-radiobutton-container'>" + question.options.map((o, i) =>
      "<div class='ssrc__radio-btn-container'><input type='radio' id='r" + id + i + "' name='radio-button' value='" + esc(o) + "' class='ssrc__radio'><label for='r" + id + i + "' class='ssrc__label'>" + esc(o) + "</label><br></div>").join("") + "</div>";
  } else if (question.kind === "chips") {
    html = "<div class='chatbot_Chips chatbot_ChipsInRow' id='chips" + id + "'>" + question.options.map((o, i) => "<div id='chip" + id + i + "' class='chatbot_Chip chipInRow chipItem'><span>" + esc(o) + "</span></div>").join("") + "</div>";
  } else if (question.kind === "dob") {
    html = "<div class='dob__container'><div class='dob__input-container'><input class='dob__input day' placeholder='DD'><input class='dob__input month' placeholder='MM'><input class='dob__input year' placeholder='YYYY'></div></div>";
  } else {
    html = "<div class='chatbot_InputContainer'><div class='textAreaWrapper'><div id='userInput_" + id + "' class='textArea' contenteditable='true' data-placeholder='Type message here...'></div></div></div>";
  }
  footer().innerHTML = html;
  footer().querySelectorAll(".chatbot_Chip").forEach((chip) => chip.addEventListener("click", () => send(chip.innerText.trim())));
}

function currentAnswer() {
  const radio = footer().querySelector(".ssrc__radio:checked");
  if (radio) return radio.value;
  const day = footer().querySelector(".dob__input.day");
  if (day) {
    const value = (selector) => footer().querySelector(selector).value.trim();
    return value(".day") && value(".month") && value(".year") ? value(".day") + "/" + value(".month") + "/" + value(".year") : "";
  }
  const text = footer().querySelector(".textArea");
  return text ? text.innerText.trim() : "";
}

function save() {
  const value = currentAnswer();
  if (value) send(value);
}

async function send(value) {
  userSays(value);
  answers.push(value);
  window.__answers = answers.slice();
  footer().innerHTML = "";
  await post(CONFIG.respond, { input: value, step });
  step += 1;
  if (step < QUESTIONS.length) {
    setTimeout(() => render(QUESTIONS[step]), 150);
    return;
  }
  botSays(["Thank you for your responses."]);
  setTimeout(async () => {
    const done = await post(CONFIG.apply, { strJobsarr: [CONFIG.jobId], applyData: { answers } });
    document.querySelector(".chatbot_Drawer").remove();
    if (done.jobs && done.jobs[0] && done.jobs[0].status === 200) markApplied();
  }, 200);
}

const apply = document.getElementById("apply-button");
if (apply) {
  apply.addEventListener("click", async () => {
    const res = await fetch(CONFIG.apply + (flow === "instant" ? "?instant=1" : flow === "refuse" ? "?refuse=1" : ""), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strJobsarr: [CONFIG.jobId] }) });
    if (!res.ok) return;
    const reply = await res.json();
    if (reply.chatbotResponse) {
      openDrawer();
      setTimeout(() => render(QUESTIONS[0]), 150);
    } else if (reply.jobs && reply.jobs[0] && reply.jobs[0].status === 200) {
      markApplied();
    }
  });
}
</script>
</body>
</html>`;
}
