import { z } from "zod";
import type { FormField } from "../adapter";

// Naukri's own Apply, read without a browser (K4, docs/naukri/TDD.md 4.7): what the job page offers, what Naukri's apply
// service answered, and the question its chat drawer asks now. Recon 5 Nov from Naukri's own scripts (the job page's
// chunk app/jd/page-*.js, the drawer's chatbot-workflow-utility/v5 bundle):
//   - the job page: #apply-button (Apply on Naukri), #company-site-button ("Apply on company site"), #already-applied
//     ("Applied"), #already-shared-interest (a walk-in's "I am interested");
//   - Apply posts to /cloudgateway-workflow/workflow-services/apply-workflow/v1/apply and gets
//     { jobs: [{ jobId, status }], chatbotResponse?, applyRedirectUrl? }: a job with status 200 and no chatbotResponse is
//     applied; a chatbotResponse opens the drawer; when the drawer's last answer is saved, the page posts the same apply
//     again with the answers (applyData) and the same reply says applied;
//   - each answer goes to /cloudgateway-chatbot/chatbot-services/botapi/v5/respond, whose reply is the next question;
//   - the drawer (.chatbot_DrawerContentWrapper): bot messages "botMsg", a text box (div.textArea, contenteditable), radio
//     buttons (.ssrc__radio / label.ssrc__label), checkboxes (.mcc__checkbox / label.mcc__label), chips
//     (.chatbot_Chip, one click sends), a date of birth (.dob__input day / month / year), suggestors, and Save (.sendMsg).
// Pure: the window side is sites/naukriApply.ts. Checked by scripts/naukri-adapter-test.ts.

export const APPLY_CALL = /\/cloudgateway-workflow\/workflow-services\/apply-workflow\/v\d+\/apply(\?|$)/;
export const RESPOND_CALL = /\/cloudgateway-chatbot\/chatbot-services\/botapi\/v\d+\/respond(\?|$)/;

/** What a Naukri job page offers before anything is pressed. */
export type JobPageState = "apply" | "company_site" | "already_applied" | "interest_only" | "expired" | "unknown";

export type JobPageSignals = { apply: boolean; companySite: boolean; applied: boolean; interest: boolean; text: string };

const EXPIRED = /(job|this job) (is )?(no longer (available|active|accepting)|has expired|expired)|no longer accepting applications|job not found|this job has been removed/i;

export function jobPageState(signals: JobPageSignals): JobPageState {
  if (signals.applied) return "already_applied";
  if (EXPIRED.test(signals.text.slice(0, 6000))) return "expired";
  if (signals.companySite && !signals.apply) return "company_site";
  if (signals.apply) return "apply";
  if (signals.interest) return "interest_only";
  return "unknown";
}

const applyReplySchema = z
  .object({
    jobs: z.array(z.object({ jobId: z.union([z.string(), z.number()]).transform(String), status: z.number().nullable().optional() }).passthrough()).nullable().optional(),
    chatbotResponse: z.unknown().optional(),
    applyRedirectUrl: z.string().nullable().optional(),
  })
  .passthrough();

/** Naukri's apply service answered: sent, the drawer opened, the company's site, or nothing that says either. */
export type ApplyReply =
  | { kind: "sent"; evidence: string }
  | { kind: "questions" }
  | { kind: "company_site"; url: string | null }
  | { kind: "refused"; detail: string }
  | { kind: "unclear"; detail: string };

export function readApplyReply(httpStatus: number, body: unknown, jobId: string): ApplyReply {
  if (httpStatus === 406) return { kind: "refused", detail: "Naukri asked for a reCAPTCHA (406)" };
  if (httpStatus === 403) return { kind: "refused", detail: "Naukri refused the apply (403)" };
  if (httpStatus < 200 || httpStatus >= 300) return { kind: "unclear", detail: `Naukri's apply service answered ${httpStatus}` };
  const parsed = applyReplySchema.safeParse(body);
  if (!parsed.success) return { kind: "unclear", detail: "Naukri's apply answer was not in the expected shape" };
  const reply = parsed.data;
  if (reply.chatbotResponse) return { kind: "questions" };
  const mine = reply.jobs?.find((job) => job.jobId === jobId);
  if (mine?.status === 200) return { kind: "sent", evidence: `Naukri's apply service answered 200 for job ${jobId}` };
  if (reply.applyRedirectUrl) return { kind: "company_site", url: reply.applyRedirectUrl };
  if (mine) return { kind: "unclear", detail: `Naukri's apply service answered ${mine.status ?? "no status"} for this job` };
  return { kind: "unclear", detail: "Naukri's apply answer did not name this job" };
}

/** What the drawer shows now, read off the page (naukriApply.ts drawerSnapshot). */
export type DrawerSnapshot = {
  open: boolean;
  /** Bot messages after the user's last answer, oldest first. */
  botTexts: string[];
  /** How many messages the drawer holds in all, to tell a new question from the one already answered. */
  messages: number;
  radios: string[];
  checkboxes: string[];
  chips: string[];
  /** The chips are a multi-select (each click adds one; Save sends them). */
  multiChips: boolean;
  textBox: boolean;
  /** The text box's own input type when it is an <input> (number, password); a contenteditable box is "text". */
  inputType: string;
  dob: boolean;
  calendar: boolean;
  suggestor: boolean;
};

export type DrawerControl = "text" | "number" | "radio" | "checkbox" | "chips" | "multi_chips" | "dob" | "suggest" | "calendar";
export type DrawerQuestion = { field: FormField; control: DrawerControl; skip: string | null };

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const SKIP = /^skip( this( question)?)?$/i;
// Greetings and asides the bot sends before the question itself.
const ASIDE = /^(hi|hello|hey)\b|^thank you|^thanks\b|^great\b|^kindly answer|^please answer (the|a few)|recruiter('s)? questions?/i;

/**
 * The question on screen as a field for the answering chain (resolveForm): its wording, its kind and options, and whether
 * it may be skipped. Null when the drawer shows no question (closed, or waiting for the bot).
 */
export function questionOf(snapshot: DrawerSnapshot, step: number): DrawerQuestion | null {
  if (!snapshot.open) return null;
  const texts = snapshot.botTexts.map(clean).filter(Boolean);
  if (texts.length === 0) return null;
  // Only thanks or greetings since the last answer (the drawer closing after the last one): no question.
  const asked = [...texts].reverse().find((text) => !ASIDE.test(text) || /\?$/.test(text));
  if (!asked) return null;
  const label = asked.slice(0, 500);
  const selector = `naukri-chat-${step}`;
  const choices = (options: string[]) => options.map(clean).filter((option) => option && !SKIP.test(option));
  const skipOf = (options: string[]) => options.map(clean).find((option) => SKIP.test(option)) ?? null;

  if (snapshot.radios.length > 0) {
    const options = choices(snapshot.radios);
    const skip = skipOf(snapshot.radios);
    return { field: { selector, label, type: "select", required: !skip, options }, control: "radio", skip };
  }
  if (snapshot.checkboxes.length > 0) {
    const options = choices(snapshot.checkboxes);
    const skip = skipOf(snapshot.checkboxes);
    return { field: { selector, label, type: "checkbox-group", required: !skip, options }, control: "checkbox", skip };
  }
  if (snapshot.chips.length > 0) {
    const options = choices(snapshot.chips);
    const skip = skipOf(snapshot.chips);
    // Chips beside a text box are suggestions: the box is the answer, a chip only a shortcut (and Skip).
    if (snapshot.textBox && !snapshot.multiChips) {
      const number = snapshot.inputType === "number";
      return { field: { selector, label, type: number ? "number" : "text", required: !skip }, control: number ? "number" : "text", skip };
    }
    if (options.length > 0) {
      const multi = snapshot.multiChips;
      return { field: { selector, label, type: multi ? "checkbox-group" : "select", required: !skip, options }, control: multi ? "multi_chips" : "chips", skip };
    }
    if (skip && !snapshot.textBox) return { field: { selector, label, type: "text", required: false }, control: "text", skip };
  }
  const skip = skipOf(snapshot.chips);
  if (snapshot.dob) return { field: { selector, label, type: "date", required: !skip }, control: "dob", skip };
  if (snapshot.calendar) return { field: { selector, label, type: "date", required: !skip }, control: "calendar", skip };
  if (snapshot.suggestor) return { field: { selector, label, type: "combobox", required: !skip }, control: "suggest", skip };
  if (snapshot.textBox) {
    const number = snapshot.inputType === "number";
    return { field: { selector, label, type: number ? "number" : "text", required: !skip }, control: number ? "number" : "text", skip };
  }
  return null;
}

/** The one option a saved value means, by Naukri's own wording (case and spacing aside); null when none does. */
export function optionFor(options: string[], value: string): string | null {
  const want = clean(value).toLowerCase();
  if (!want) return null;
  return options.find((option) => clean(option).toLowerCase() === want) ?? null;
}

/** A multi-select answer ("Java, React") as the options it names; null when any part names none of them. */
export function optionsFor(options: string[], value: string): string[] | null {
  const parts = value.split(/\s*[,;\n]\s*/).map(clean).filter(Boolean);
  if (parts.length === 0) return null;
  const picked: string[] = [];
  for (const part of parts) {
    const option = optionFor(options, part);
    if (!option) return null;
    if (!picked.includes(option)) picked.push(option);
  }
  return picked;
}

/** A date of birth as Naukri's three boxes want it (DD, MM, YYYY), from 1990-04-07, 07/04/1990 or 7-4-1990. */
export function dobParts(value: string): { day: string; month: string; year: string } | null {
  const iso = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const dmy = value.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const [year, month, day] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
  if (!year) return null;
  const d = Number(day);
  const m = Number(month);
  if (d < 1 || d > 31 || m < 1 || m > 12) return null;
  return { day: String(d).padStart(2, "0"), month: String(m).padStart(2, "0"), year };
}
