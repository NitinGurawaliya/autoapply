import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page, Request } from "playwright";
import { joinChoices, splitChoices } from "@/lib/choices";
import { customQuestionKey } from "@/modules/answers";
import type { AtsAdapter, FilledField, FormField, ResolvedValue, SubmitContext, SubmitResult } from "../adapter";
import { BotCheckError, MaybeSentError, NeedsAnswerError, NoRetryError, NotSentError, WindowClosedError } from "../adapter";
import { canShowWindow, livePage } from "../browser";
import { assertJobOpen, dismissOverlays, firstVisible, friendlyError, inField } from "./common";

// Lever hosts every company's form on jobs.lever.co/<company>/<id>/apply (jobs.eu.lever.co for the EU).
function formUrl(job: { applyUrl: string }) {
  const url = job.applyUrl.split(/[?#]/)[0].replace(/\/+$/, "");
  return /\/apply$/i.test(url) ? url : `${url}/apply`;
}

const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
const byName = (name: string) => `[name="${name.replace(/"/g, '\\"')}"]`;

// Lever names the fixed fields instead of labelling them with ids, so tell the mapper what they are.
function hintFor(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower === "name") return "full_name";
  if (lower === "email") return "email";
  if (lower === "phone") return "phone";
  if (lower === "org") return "current_company";
  if (lower === "location") return "city";
  if (lower === "resume") return "resume";
  if (lower === "urls[linkedin]") return "linkedin";
  // Companies name their own link fields ("urls[Github / Stack Overflow]", "urls[Website]"); Naukri, Twitter and the like
  // are no facts we hold (T94 research, 31 Oct).
  if (/^urls\[.*github/.test(lower)) return "github";
  if (/^urls\[.*linkedin/.test(lower)) return "linkedin";
  if (/^urls\[(portfolio|website|personal (site|website)|blog)\]$/.test(lower)) return "portfolio";
  return undefined;
}

type Row = { name: string; label: string; kind: string; required: boolean; options?: string[] };

// Runs inside the page. A plain string on purpose: tsx would wrap named helpers in a function the page does not have.
const READ_FORM = `(() => {
  const form = document.querySelector('#application-form') || document;
  const rows = [];
  const seen = new Set();
  const clean = (text) => (text || '').replace(/\\u2731/g, '').replace(/\\s+/g, ' ').trim();
  form.querySelectorAll('li.application-question').forEach((li) => {
    if (li.querySelector('.awli-button-container')) return;
    const labelEl = li.querySelector('.application-label');
    const textEl = labelEl ? labelEl.querySelector('.text') : null;
    const label = clean(textEl ? textEl.textContent : labelEl ? labelEl.textContent : '');
    // Some controls carry only the required attribute (consent[store], T94 research).
    const required = Boolean(li.querySelector('.required-field, .application-label .required, .text .required, input[required], select[required], textarea[required]'));
    const controls = Array.from(li.querySelectorAll('input, select, textarea')).filter((c) => c.type !== 'hidden' && c.name);
    const groups = new Map();
    controls.forEach((c) => groups.set(c.name, [...(groups.get(c.name) || []), c]));
    groups.forEach((list, name) => {
      if (seen.has(name)) return;
      seen.add(name);
      const first = list[0];
      const optionLabel = (c) => clean((c.closest('label') || c.parentElement).textContent);
      if (first.type === 'file') rows.push({ name, label: label || 'Resume/CV', kind: 'file', required: true });
      else if (first.id === 'location-input') rows.push({ name, label: label || 'Current location', kind: 'location', required });
      else if (first.tagName === 'SELECT') rows.push({ name, label, kind: 'select', required, options: Array.from(first.options).filter((o) => o.value).map((o) => clean(o.textContent)) });
      else if (first.tagName === 'TEXTAREA') rows.push({ name, label, kind: 'textarea', required });
      else if (first.type === 'radio') rows.push({ name, label, kind: 'radio', required, options: list.map(optionLabel) });
      else if (first.type === 'checkbox' && list.length > 1) rows.push({ name, label, kind: 'checkbox-group', required, options: list.map(optionLabel) });
      else if (first.type === 'checkbox') rows.push({ name, label: label || optionLabel(first), kind: 'checkbox', required });
      else rows.push({ name, label, kind: 'text', required });
    });
  });
  const file = form.querySelector('input[type=file][name=resume]');
  if (file && !seen.has('resume')) rows.push({ name: 'resume', label: 'Resume/CV', kind: 'file', required: true });
  return rows;
})()`;

async function readFields(page: Page): Promise<FormField[]> {
  await page
    .locator("#application-form")
    .waitFor({ timeout: 25000 })
    .catch(async (error) => {
      await assertJobOpen(page);
      throw error;
    });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  const rows = (await page.evaluate(READ_FORM)) as Row[];
  const fields: FormField[] = [];
  for (const row of rows) {
    // The optional demographic survey is left blank: an unanswered question is the same as "decline to answer".
    if (row.name.startsWith("surveysResponses") && !row.required) continue;
    fields.push({
      selector: byName(row.name),
      label: row.label || row.name,
      type: row.kind,
      required: row.required,
      options: row.options,
      hintKey: hintFor(row.name),
    });
  }
  return fields;
}

/** Lever reads the resume after it is attached; wait for that to finish before touching the form. */
async function attachFile(page: Page, value: ResolvedValue, bytes: Uint8Array) {
  const name = value.fileName ?? "resume.pdf";
  const dir = await mkdtemp(join(tmpdir(), "swipeapply-"));
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true });
  };
  try {
    const file = join(dir, name);
    await writeFile(file, bytes);
    await page.locator('input[name="resume"]').setInputFiles(file);
    // The file name appears in the resume row (shown in capitals by the page's CSS), then "Analyzing resume..."
    // gives way to "Success!" once the parser has filled what it could.
    await page.waitForFunction(
      (fileName) => {
        const shown = document.querySelector("li.application-question.resume .filename")?.textContent ?? "";
        // innerText, not textContent: the "Analyzing" message stays in the page, hidden, after it is done.
        const row = (document.querySelector("li.application-question.resume") as HTMLElement | null)?.innerText ?? "";
        return shown.toLowerCase().includes(fileName.toLowerCase()) && !/analy[sz]ing resume/i.test(row);
      },
      name,
      { timeout: 45000 },
    );
    return cleanup;
  } catch (error) {
    await cleanup();
    throw new Error(`Resume upload failed: ${error instanceof Error ? error.message.split("\n")[0] : "no confirmation"}`);
  }
}

function pickLabel(options: string[], wanted: string) {
  const target = norm(wanted);
  const normalised = options.map(norm);
  const exact = normalised.indexOf(target);
  if (exact >= 0) return exact;
  const starts = normalised.findIndex((option) => option.startsWith(target));
  if (starts >= 0) return starts;
  return normalised.findIndex((option) => option.includes(target));
}

async function fillLocation(page: Page, value: ResolvedValue) {
  const input = page.locator("#location-input");
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await input.fill("");
  const results = page.locator(".dropdown-results .dropdown-location");
  // Lever's search lists "Bengaluru, Bengaluru Urban, Karnataka, IND": a full "City, State, India" can find nothing, the
  // city alone finds it (T94 research).
  let texts: string[] = [];
  for (const term of [...new Set([value.value.trim(), value.value.split(",")[0].trim()])].filter(Boolean)) {
    await input.fill("");
    await input.pressSequentially(term, { delay: 60 });
    await results.first().waitFor({ timeout: 8000 }).catch(() => undefined);
    texts = (await results.allInnerTexts()).map((text) => text.trim());
    if (texts.length > 0) break;
  }
  if (texts.length === 0) {
    await input.fill("");
    // An optional location with no match is skipped; a required one asks the user for another search word.
    if (!value.required) return null;
    throw new NeedsAnswerError({ key: customQuestionKey(value.label), label: `${value.label} (nothing matched "${value.value}", try another search word)`, type: "text", required: true });
  }
  const index = Math.max(0, pickLabel(texts, value.value));
  await results.nth(index).click();
  await page.waitForFunction(() => Boolean((document.querySelector("#selected-location") as HTMLInputElement | null)?.value), undefined, { timeout: 5000 }).catch(() => undefined);
  return texts[index];
}

const CONFIRMATION = /application submitted|thank you for applying|thanks for applying|we('| ha)ve received your application/i;

async function captchaChallengeVisible(page: Page) {
  const frames = page.locator('iframe[src*="hcaptcha.com"][title*="challenge" i]');
  const count = await frames.count();
  for (let index = 0; index < count; index += 1) {
    const box = await frames.nth(index).boundingBox({ timeout: 1000 }).catch(() => null);
    if (box && box.height > 120 && (await frames.nth(index).isVisible())) return true;
  }
  return false;
}

async function invalidFieldLabels(page: Page) {
  return page.evaluate(
    `Array.from(document.querySelectorAll('#application-form :invalid')).map((el) => {
      const li = el.closest('li');
      const label = li && li.querySelector('.application-label');
      return ((label && label.textContent) || el.getAttribute('name') || '').replace(/\\u2731/g, '').replace(/\\s+/g, ' ').trim();
    }).filter(Boolean)`,
  ) as Promise<string[]>;
}

/** Lever's own success state on the page, as evidence, or null. */
async function successShown(page: Page) {
  if (/\/thanks\b|\/confirmation\b/i.test(page.url())) return `url ${page.url().replace(/[0-9a-f-]{36}/i, "<id>")}`;
  // Still on the form: its own wording ("Thank you for your interest…") is no answer from Lever.
  if (/\/apply\b/i.test(page.url())) return null;
  const body = await page.locator("body").innerText().catch(() => "");
  const match = body.match(CONFIRMATION);
  return match ? `text "${match[0]}"` : null;
}

// How long the worker's own Submit has to show Lever's thanks page; a person gets 15 minutes (a challenge to complete).
const AUTO_WAIT_MS = 60000;
const PERSON_WAIT_MS = 15 * 60 * 1000;
// Lever's form posts to the posting's own /apply address (hCaptcha's requests go to hcaptcha.com, not this).
const APPLY_POST = /^https:\/\/jobs(\.eu)?\.lever\.co\/[^/]+\/[0-9a-f-]{36}\/apply/i;

/**
 * T94: Lever forms carry hCaptcha on Submit (#hcaptchaSubmitBtn). As Ashby's reCAPTCHA (adapters/ashby.ts): the worker
 * presses Submit once itself, a plain click with nothing about the browser changed, and hCaptcha decides. A challenge is
 * never solved: in a visible window (the handoff queue, a worker with a screen) the same window becomes the person's,
 * the filled form kept, and they complete it and press Submit; without a screen the run stops as not sent and the runner
 * passes it to a worker with one (BotCheckError, runner.ts). On a run already with a person (ctx.person) the worker never
 * presses Submit. Only Lever's thanks page counts as sent; a Submit request that left with no thanks page seen is
 * "may have been sent", never "not sent".
 */
async function submitLever(page: Page, ctx: SubmitContext): Promise<SubmitResult> {
  await dismissOverlays(page);
  // Lever's own validation says what is missing; clicking Submit with a hole in the form only costs a bad attempt.
  const missing = await invalidFieldLabels(page);
  if (missing.length > 0) throw new NoRetryError(`Lever needs these filled before it will submit: ${[...new Set(missing)].slice(0, 5).join(", ")}`);
  const button = await firstVisible(page, ["#hcaptchaSubmitBtn", "button[type=submit].postings-btn", "#btn-submit", "button[type=submit]"], 20000);
  if (!button) throw new NoRetryError("The Submit button never appeared on the Lever form. Open the form and submit it yourself.");
  await button.scrollIntoViewIfNeeded().catch(() => undefined);
  let posted = false;
  const stopWatching = leverAdapter.watchSubmit!(page, () => {
    posted = true;
  });
  let withPerson = Boolean(ctx.person);
  let deadline = Date.now() + (withPerson ? PERSON_WAIT_MS : AUTO_WAIT_MS);
  const askPerson = async (what: string) => {
    if (!ctx.handoff || !canShowWindow()) throw new BotCheckError(`${what} when the worker pressed Submit. Nothing was sent.`);
    withPerson = true;
    deadline = Date.now() + PERSON_WAIT_MS;
    await ctx.announceHandoff?.(`${what}: complete it in the Chrome window on your computer, then press Submit if the form is still there`);
  };
  try {
    if (withPerson) {
      await page.bringToFront().catch(() => undefined);
      await ctx.announceHandoff?.("Lever asked to confirm a person is applying: check the form in the Chrome window on your computer, press Submit and complete the check");
    } else {
      // Attempted only once the form's own POST leaves (runner.ts watchSubmit), as Ashby: a click hCaptcha holds sends
      // nothing, and a challenge, a closed window or Lever's validation must not read as "check your email".
      try {
        await button.click({ timeout: 15000 });
      } catch (error) {
        throw new NotSentError(`Could not press Submit on the Lever form: ${friendlyError(error)}`);
      }
    }
    let challenged = false;
    for (;;) {
      const live = livePage(page);
      if (!live) {
        if (posted) throw new MaybeSentError("The Lever window closed after the form was sent, before its thanks page showed. Check your email before applying again.");
        throw new WindowClosedError("The Lever window was closed before the form was sent. Nothing was sent.");
      }
      // The thanks page opens with a plain GET too (T94 research): it counts only after the form's own POST left.
      const evidence = posted ? await successShown(live) : null;
      if (evidence) return { confirmed: true, evidence };
      if (!challenged && (await captchaChallengeVisible(live))) {
        challenged = true;
        if (!withPerson) await askPerson("Lever's hCaptcha showed a challenge");
      }
      // Lever's validation after the click: nothing was sent while it shows (only before the form went out).
      if (!posted && !withPerson) {
        const invalid = await invalidFieldLabels(live);
        if (invalid.length > 0 && Date.now() > deadline - AUTO_WAIT_MS + 6000) throw new NotSentError(`Lever rejected the form: ${[...new Set(invalid)].slice(0, 5).join(", ")}`);
      }
      if (Date.now() >= deadline) {
        if (posted) throw new MaybeSentError("Submit was pressed but Lever's thanks page did not show. Check your email before applying again.");
        // Nothing left the window after the worker's click: hCaptcha may have held it without showing a challenge.
        if (!withPerson) {
          await askPerson("Nothing reached Lever after the worker pressed Submit (its hCaptcha may have stopped it)");
          continue;
        }
        throw new NotSentError("Submit was not pressed within 15 minutes. Nothing was sent; press Retry when you are ready.");
      }
      if (await ctx.cancelled?.()) {
        if (posted) throw new MaybeSentError("Cancelled after the form was sent to Lever, before its thanks page showed. Check your email before applying again.");
        throw new WindowClosedError("Cancelled by you before the form was sent. Nothing was sent.");
      }
      await live.waitForTimeout(1000).catch(() => undefined);
    }
  } finally {
    stopWatching();
  }
}

export const leverAdapter: AtsAdapter = {
  source: "lever",
  matches(url: string) {
    return /lever\.co/i.test(url);
  },
  formUrl,
  uploadFirst: true,
  uploadFile: attachFile,
  inspect(page: Page) {
    return readFields(page);
  },
  async fill(page, values) {
    const filled: FilledField[] = [];
    await dismissOverlays(page);
    for (const value of values) {
      if (value.type === "file") continue;
      const written = await inField(value.label, async () => {
        const target = page.locator(value.selector);
        if (value.type === "location") return fillLocation(page, value);
        if (value.type === "select") {
          await target.first().selectOption({ label: value.value }).catch(async () => {
            await target.first().selectOption(value.value);
          });
          return value.value;
        }
        if (value.type === "radio" || value.type === "checkbox-group") {
          const labels = await target.evaluateAll((nodes) => nodes.map((node) => ((node.closest("label") ?? node.parentElement)?.textContent ?? "").replace(/\s+/g, " ").trim()));
          // A checkbox group may hold several choices, one per line (lib/choices.ts); a radio holds one.
          const wanted = value.type === "checkbox-group" ? splitChoices(value.value) : [value.value];
          const picked: string[] = [];
          for (const choice of wanted) {
            const index = pickLabel(labels, choice);
            if (index < 0) throw new Error(`No option "${choice}" for "${value.label}"`);
            // A forced check sometimes does not take (31 Oct, JumpCloud: something covered the input): the label, then a click.
            await target.nth(index).check({ force: true }).catch(async () => {
              await target.nth(index).evaluate((input) => ((input.closest("label") as HTMLElement | null) ?? (input as HTMLElement)).click());
              if (!(await target.nth(index).isChecked())) await target.nth(index).evaluate((input) => (input as HTMLInputElement).click());
            });
            picked.push(labels[index]);
          }
          return joinChoices(picked);
        }
        if (value.type === "checkbox") {
          if (/^(yes|true|checked|agree|i agree|1)$/i.test(value.value.trim())) await target.first().check({ force: true });
          else await target.first().uncheck({ force: true });
          return value.value;
        }
        await target.first().fill(value.value);
        return value.value;
      });
      if (written === null) continue;
      filled.push({ key: value.key, label: value.label, value: written, source: value.source, selector: value.selector });
    }
    return filled;
  },
  // The window is the person's from the moment it opens (a handoff board): the form's own POST is the moment it may be sent.
  watchSubmit(page: Page, onSubmit: () => void) {
    const context = page.context();
    let seen = false;
    const onRequest = (request: Request) => {
      if (seen || request.method() !== "POST" || !APPLY_POST.test(request.url())) return;
      seen = true;
      onSubmit();
    };
    context.on("request", onRequest);
    return () => context.off("request", onRequest);
  },
  confirmation(page: Page) {
    return successShown(page);
  },
  submit: submitLever,
};
