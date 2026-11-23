import type { Page, Response } from "playwright";
import { NeedsAnswerError, NotSentError } from "../adapter";
import { pageStop, type PageStop } from "./naukri";
import { APPLY_CALL, dobParts, jobPageState, optionFor, optionsFor, questionOf, readApplyReply, RESPOND_CALL, type ApplyReply, type DrawerQuestion, type DrawerSnapshot, type JobPageSignals, type JobPageState } from "./naukriChat";

// Naukri's own Apply in the user's signed-in window (K4, docs/naukri/TDD.md 4.7): the only Playwright code that presses
// anything on Naukri. Reads the job page, presses Apply, and answers the chat drawer one question at a time; whether it
// was sent is read from the reply of Naukri's own apply service to its own page (naukriChat.ts readApplyReply), never
// from page text alone. The runner (runner.ts executeOnSite) decides every answer and every status.

const DRAWER = ".chatbot_DrawerContentWrapper";
const WAIT_MS = 30_000;
// After the bot's reply, the drawer is read only once nothing has changed for this long (it types messages in one by one).
const SETTLE_MS = 1200;

export type JobPageRead = { kind: "state"; state: JobPageState } | { kind: "stop"; stop: PageStop; detail: string };

/** What the job page offers, signed in, before anything is pressed. Waits for one of its buttons to render. */
export async function readJobPage(page: Page): Promise<JobPageRead> {
  const buttons = "#apply-button, #company-site-button, #already-applied, #already-shared-interest";
  await page.locator(buttons).first().waitFor({ state: "attached", timeout: 20_000 }).catch(() => undefined);
  // Signed out, Naukri still shows Apply, which then asks to sign in; its header's Login link says so first.
  if (await page.locator("#login_Layer").isVisible().catch(() => false)) return { kind: "stop", stop: "needs_signin", detail: "Naukri showed the job signed out" };
  const signals = (await page.evaluate(READ_JOB_PAGE)) as JobPageSignals;
  const state = jobPageState(signals);
  if (state !== "unknown") return { kind: "state", state };
  const stopped = await pageStop(page);
  return stopped.stop === "error" ? { kind: "state", state } : { kind: "stop", ...stopped };
}

// Page scripts are strings, run as written: a compiled function would carry the compiler's helpers into the page (tsx
// wraps named inner functions in __name, which the page does not have), as adapters/keka.ts found.
const READ_JOB_PAGE = `(() => {
  const shown = (selector) => {
    const element = document.querySelector(selector);
    return Boolean(element && element.getClientRects().length > 0);
  };
  return {
    apply: shown("#apply-button"),
    companySite: shown("#company-site-button"),
    applied: shown("#already-applied"),
    interest: shown("#already-shared-interest"),
    text: ((document.body && document.body.innerText) || "").slice(0, 6000),
  };
})()`;

const READ_DRAWER = `((drawer) => {
  const root = document.querySelector(drawer);
  const empty = { open: false, botTexts: [], messages: 0, radios: [], checkboxes: [], chips: [], multiChips: false, textBox: false, inputType: "text", dob: false, calendar: false, suggestor: false };
  if (!root || root.getClientRects().length === 0) return empty;
  const visible = (element) => element.getClientRects().length > 0 && !element.closest(".d-none");
  const text = (element) => (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
  const items = Array.from(root.querySelectorAll("ul[id^='chatList_'] > li, .chatbot_MessageContainer li"));
  let lastUser = -1;
  items.forEach((item, index) => {
    const cls = String(item.className) + " " + String((item.firstElementChild && item.firstElementChild.className) || "");
    // The user's answers: "userItem" items, or a chip bubble that is not the bot's own (bot items say "botItem").
    if (/userItem|userMsg/.test(cls) || (!/botItem/.test(cls) && item.querySelector(".userMsg, .chipMsg"))) lastUser = index;
  });
  const botTexts = items.slice(lastUser + 1).flatMap((item) => Array.from(item.querySelectorAll(".botMsg")).map(text)).filter(Boolean);
  const lastOf = (selector) => {
    const all = Array.from(root.querySelectorAll(selector)).filter(visible);
    return all[all.length - 1] || null;
  };
  const radioBox = lastOf(".singleselect-radiobutton-container, .singleselect-radiobutton");
  const checkBox = lastOf(".multicheckboxes-container, .multiselectcheckboxes");
  const chipBox = lastOf(".chatbot_Chips");
  const input = lastOf(".chatbot_InputContainer .textArea, .textAreaWrapper .textArea");
  return {
    open: true,
    botTexts,
    messages: items.length,
    radios: radioBox ? Array.from(radioBox.querySelectorAll("label.ssrc__label")).map(text) : [],
    checkboxes: checkBox ? Array.from(checkBox.querySelectorAll("label.mcc__label")).map(text) : [],
    chips: chipBox ? Array.from(chipBox.querySelectorAll(".chatbot_Chip")).map(text) : [],
    multiChips: Boolean(chipBox && chipBox.querySelector(".chatBot-add, .chatBot-tick, .chatbot_Selected")),
    textBox: Boolean(input),
    inputType: input && input.tagName === "INPUT" ? (input.type || "text") : "text",
    dob: Boolean(lastOf(".dob__container")),
    calendar: Boolean(lastOf(".calendar-container")),
    suggestor: Boolean(lastOf(".singleselect-sugg-container, .multiselect-suggestor-container, .multi-select-suggestor")),
  };
})`;

/** What the drawer shows, read off the page in one go (naukriChat.ts questionOf turns it into a question). */
export async function drawerSnapshot(page: Page): Promise<DrawerSnapshot> {
  return (await page.evaluate(`${READ_DRAWER}(${JSON.stringify(DRAWER)})`)) as DrawerSnapshot;
}

/**
 * Naukri's own apply calls and the bot's replies, as the page receives them, from the moment Apply is pressed. The page
 * posts the apply once on the click and again when the drawer's last answer is saved.
 */
export class ApplyWatch {
  readonly replies: ApplyReply[] = [];
  applyRequests = 0;
  botReplies = 0;
  lastActivity = Date.now();
  private readonly onRequest = (request: { url(): string; method(): string }) => {
    if (request.method() === "POST" && APPLY_CALL.test(request.url())) {
      this.applyRequests += 1;
      this.lastActivity = Date.now();
    }
  };
  private readonly onResponse = (response: Response) => {
    const url = response.url();
    if (RESPOND_CALL.test(url)) {
      this.botReplies += 1;
      this.lastActivity = Date.now();
      return;
    }
    if (response.request().method() !== "POST" || !APPLY_CALL.test(url)) return;
    this.lastActivity = Date.now();
    const status = response.status();
    void response
      .json()
      .catch(() => null)
      .then((body) => {
        this.replies.push(readApplyReply(status, body, this.jobId));
        this.lastActivity = Date.now();
      });
  };

  constructor(private readonly page: Page, private readonly jobId: string) {
    page.on("request", this.onRequest);
    page.on("response", this.onResponse);
  }

  stop() {
    this.page.off("request", this.onRequest);
    this.page.off("response", this.onResponse);
  }
}

export type NaukriStep =
  | { kind: "question"; question: DrawerQuestion; messages: number }
  | { kind: "sent"; evidence: string }
  | { kind: "company_site" }
  | { kind: "stopped"; stop: PageStop; detail: string }
  | { kind: "unclear"; detail: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * After Apply or an answer: waits for what Naukri does next. A sent reply wins over anything on screen; a new question
 * counts once the drawer has settled after the bot's reply, and only while no apply is still on its way.
 */
async function nextStep(page: Page, watch: ApplyWatch, since: { replies: number; messages: number }, step: number): Promise<NaukriStep> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (page.isClosed()) return { kind: "unclear", detail: "The Naukri window closed" };
    const reply = watch.replies.slice(since.replies).reverse().find(Boolean);
    if (reply?.kind === "sent") return { kind: "sent", evidence: reply.evidence };
    if (reply?.kind === "company_site") return { kind: "company_site" };
    if (reply?.kind === "refused") return { kind: "stopped", stop: "challenge", detail: reply.detail };
    const awaitingApply = watch.applyRequests > watch.replies.length;
    if (!awaitingApply && Date.now() - watch.lastActivity >= SETTLE_MS) {
      const snapshot = await drawerSnapshot(page).catch(() => null);
      if (snapshot?.open && snapshot.messages > since.messages) {
        const question = questionOf(snapshot, step);
        if (question) return { kind: "question", question, messages: snapshot.messages };
      }
      // A check or a sign-in page instead of the drawer.
      const stopped = await pageStop(page).catch(() => null);
      if (stopped && stopped.stop !== "error" && !snapshot?.open) return { kind: "stopped", ...stopped };
      if (reply?.kind === "unclear" && !snapshot?.open) return { kind: "unclear", detail: reply.detail };
    }
    await sleep(400);
  }
  const last = watch.replies[watch.replies.length - 1];
  return { kind: "unclear", detail: last?.kind === "unclear" ? last.detail : "Naukri did not answer in time" };
}

/** Presses Apply on the job page (the runner has already recorded the attempt) and returns what Naukri did. */
export async function pressApply(page: Page, watch: ApplyWatch): Promise<NaukriStep> {
  const since = { replies: watch.replies.length, messages: 0 };
  await page.locator("#apply-button").first().click({ timeout: 15_000 });
  return nextStep(page, watch, since, 1);
}

const exact = (text: string) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");

async function save(page: Page) {
  const button = page.locator(`${DRAWER} .sendMsg`).last();
  await button.click({ timeout: 10_000 });
}

/**
 * Answers the question on screen with `value` (one option, several comma-separated, a date of birth, or text), or with
 * the drawer's own Skip when `value` is null and the question may be skipped. Throws NeedsAnswerError when the value
 * fits none of the options on screen: nothing is sent while a question is open, so the runner may ask the user.
 */
export async function answer(page: Page, watch: ApplyWatch, current: { question: DrawerQuestion; messages: number }, value: string | null, step: number): Promise<NaukriStep> {
  const { question } = current;
  const since = { replies: watch.replies.length, messages: current.messages };
  const drawer = page.locator(DRAWER);
  const pending = () => ({ key: question.field.label, label: question.field.label, type: question.field.type, options: question.field.options, required: question.field.required });

  if (value === null) {
    if (!question.skip) throw new NeedsAnswerError(pending());
    await drawer.locator(".chatbot_Chip").filter({ hasText: exact(question.skip) }).last().click();
    return nextStep(page, watch, since, step + 1);
  }

  const options = question.field.options ?? [];
  switch (question.control) {
    case "radio": {
      const option = optionFor(options, value);
      if (!option) throw new NeedsAnswerError(pending());
      await drawer.locator("label.ssrc__label").filter({ hasText: exact(option) }).last().click();
      await save(page);
      break;
    }
    case "checkbox": {
      const picked = optionsFor(options, value);
      if (!picked) throw new NeedsAnswerError(pending());
      for (const option of picked) await drawer.locator("label.mcc__label").filter({ hasText: exact(option) }).last().click();
      await save(page);
      break;
    }
    case "chips": {
      const option = optionFor(options, value);
      if (!option) throw new NeedsAnswerError(pending());
      // One chip is the answer: the click sends it.
      await drawer.locator(".chatbot_Chips").last().locator(".chatbot_Chip").filter({ hasText: exact(option) }).first().click();
      break;
    }
    case "multi_chips": {
      const picked = optionsFor(options, value);
      if (!picked) throw new NeedsAnswerError(pending());
      for (const option of picked) await drawer.locator(".chatbot_Chips").last().locator(".chatbot_Chip").filter({ hasText: exact(option) }).first().click();
      await save(page);
      break;
    }
    case "dob": {
      const parts = dobParts(value);
      if (!parts) throw new NeedsAnswerError(pending());
      await drawer.locator(".dob__input.day").last().fill(parts.day);
      await drawer.locator(".dob__input.month").last().fill(parts.month);
      await drawer.locator(".dob__input.year").last().fill(parts.year);
      await save(page);
      break;
    }
    case "suggest": {
      const box = drawer.locator(".ssc__textarea, .chatbot_InputContainer .textArea").last();
      await box.click();
      await box.fill(value);
      const suggestion = drawer.locator(".ssc__listLi, .chatbot_SuggestorItem").filter({ hasText: exact(value) }).first();
      await suggestion.waitFor({ state: "visible", timeout: 5000 }).catch(() => undefined);
      if (!(await suggestion.isVisible().catch(() => false))) throw new NeedsAnswerError({ ...pending(), label: `${question.field.label} (nothing matched "${value.slice(0, 40)}")` });
      await suggestion.click();
      await save(page);
      break;
    }
    case "calendar":
      throw new NotSentError(`Naukri asked "${question.field.label.slice(0, 80)}" with a calendar your agent cannot fill yet; nothing was sent`);
    default: {
      const box = drawer.locator(".chatbot_InputContainer .textArea, .textAreaWrapper .textArea").last();
      await box.click();
      await box.fill(value);
      await save(page);
    }
  }
  return nextStep(page, watch, since, step + 1);
}
