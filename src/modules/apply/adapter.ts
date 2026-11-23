import type { Page } from "playwright";

export type FormField = {
  selector: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  /** The answer key this field is, when the form tells us by name rather than by label (Lever: name, org, urls[...]). */
  hintKey?: string;
};

export type ResolvedValue = {
  key: string;
  label: string;
  value: string;
  source: string;
  selector: string;
  type: string;
  fileName?: string;
  /** Whether the form marks this field required, so an adapter knows if a miss may be skipped. */
  required?: boolean;
  /** Why this value was chosen when it did not come straight from the bank or profile ("your answer to ..."). */
  basis?: string;
};

export type FilledField = {
  key: string;
  label: string;
  value: string;
  source: string;
  selector: string;
  basis?: string;
};

export type PendingQuestion = {
  key: string;
  label: string;
  type: string;
  options?: string[];
  required: boolean;
};

export type SubmitResult = {
  confirmed: boolean;
  evidence: string;
};

export type SubmitContext = {
  /** Ask the user for a one-time code the ATS emailed them. Resolves null if they do not answer in time. */
  requestCode(prompt: string): Promise<string | null>;
  /** True when the user presses Submit themselves (the form is filled in a visible window; see browser.ts). */
  handoff?: boolean;
  /** The board already asked for a person on this application (Ashby's bot check): the worker never presses Submit itself. */
  person?: boolean;
  /** Tell the user the form is filled and waiting for them to press Submit (an event and a push). */
  announceHandoff?(message: string): Promise<void>;
  /** True once the user cancelled this application. */
  cancelled?(): Promise<boolean>;
  /** Short run tag for ASHBY_DIAGNOSTICS log lines (the end of the application id). */
  diagnosticsTag?: string;
  /**
   * Called right before Submit is pressed (handoff: when the first request leaves the window once it is ready). From
   * then on the application may have been sent: no automatic retry, and an unconfirmed outcome is pending_verification.
   */
  markAttempted?(): void | Promise<void>;
};

/**
 * Phase U (docs/accounts/TDD.md 4.5): what an account board's `prepare` gets before the form is read. The account step
 * (accountStep.ts) uses it to sign in, or create the account, with the user's own email and application password.
 */
export type PrepareContext = {
  userId: string;
  email: string;
  company: string;
  /** Ask the user for a code the employer emailed them (the needs-you code sheet; the browser is held up to 10 min). */
  requestCode(prompt: string): Promise<string | null>;
  /** A person finishes a step in the window (a check that stopped the worker's click, an account we cannot sign in to). */
  announceHandoff?(message: string): Promise<void>;
  /** An event on the application's story (never with a password in it). */
  log(type: string, message: string): Promise<void>;
};

export interface AtsAdapter {
  source: "greenhouse" | "lever" | "ashby" | "keka" | "workable" | "zohorecruit" | "smartrecruiters" | "workday" | "mock";
  /**
   * Boards that need an employer account (Workday, Phase U): runs after the form page opens and before `inspect`, and
   * leaves the page on the form's first step, signed in. Throws AccountVerificationError when the user must verify
   * their email first, AccountError when the account cannot be used.
   */
  prepare?(page: Page, ctx: PrepareContext): Promise<void>;
  /**
   * Fills and submits in the same real Chrome window as a handoff (visible where the worker has a screen, headless
   * where it has none), with the worker pressing Submit itself (25 Oct: Greenhouse, as Ashby).
   */
  window?: boolean;
  matches(url: string): boolean;
  /** URL of the actual application form, when the listing URL is not the form itself. */
  formUrl?(job: { applyUrl: string; externalId: string; companySlug: string }): string;
  inspect(page: Page): Promise<FormField[]>;
  /** The ATS parses the resume on upload and fills fields from it, so upload first and fill after, so ours win. */
  uploadFirst?: boolean;
  /** Attach a file the way this ATS expects; returns a cleanup that deletes the temp file. Defaults to setInputFiles. */
  uploadFile?(page: Page, value: ResolvedValue, bytes: Uint8Array): Promise<() => Promise<void>>;
  /** uploadFile attaches to the value's own field (its selector), so a cover letter can go in beside the resume
   * (letter.ts). Without it only the resume is attached; an adapter without uploadFile always goes by the selector. */
  attachesBySelector?: boolean;
  fill(page: Page, values: ResolvedValue[]): Promise<FilledField[]>;
  /**
   * Multi-page forms (SmartRecruiters' screening page, M7; Workday later): after the current page is filled, move to the
   * next one and return its fields, which the runner answers through the same chain as the first page and fills with
   * `fill`. Returns null once the form is at its Submit step. Called repeatedly, a few pages at most.
   */
  nextStep?(page: Page): Promise<FormField[] | null>;
  submit(page: Page, ctx: SubmitContext): Promise<SubmitResult>;
  /**
   * Handoff boards: calls onSubmit when the window sends the board's submission, from the moment the window opens (a
   * person can press Submit while the form is still being filled). Returns a function that stops watching.
   */
  watchSubmit?(page: Page, onSubmit: () => void): () => void;
  /** Handoff boards: the board's own success state on the page, as evidence, or null. */
  confirmation?(page: Page): Promise<string | null>;
}

/** Thrown mid-fill when a saved answer does not fit the form's live options; the runner asks the user instead of failing. */
export class NeedsAnswerError extends Error {
  constructor(public question: PendingQuestion) {
    super(`No matching option for "${question.label}"`);
  }
}

/** Thrown once a submit may have reached the employer; the runner must not retry and risk a duplicate application. */
export class NoRetryError extends Error {}

/**
 * After Submit may have gone out, the board showed that nothing was sent (a CAPTCHA, a refusal, validation errors, a
 * security code not given or not accepted, Submit never pressed). The run fails and the user may retry it. Any other
 * error after that point leaves the outcome unknown: the runner marks it pending_verification and never retries it.
 */
export class NotSentError extends NoRetryError {}

/** After Submit may have gone out, nothing confirms either way. The runner marks it pending_verification. */
export class MaybeSentError extends NoRetryError {}

/** Handoff: the window was closed and no submission ever left it, so nothing was sent and the form can open again. */
export class WindowClosedError extends NotSentError {}

/**
 * The board said on the page that it refused the submission (a spam refusal, Keka's own messages): nothing was sent,
 * even after a Submit. `screenshot`: the page when it said so, for when the window is closed before the run stops.
 */
export class RefusedError extends NotSentError {
  constructor(message: string, public screenshot?: Buffer) {
    super(message);
  }
}

/**
 * The board refused the CAPTCHA the agent read (Keka's "Invalid captcha"): nothing was sent, so the run starts again from
 * the form with a new CAPTCHA, a few times in a row, before it fails (runner.ts, 3 Nov).
 */
export class CaptchaRejectedError extends RefusedError {}

/**
 * The worker's own Submit was stopped by the board's bot check (a CAPTCHA challenge shown, or a code emailed) before
 * anything was sent, on a worker with no screen to show it on. The runner hands the application to a person
 * at a worker with a screen (runner.ts; the queue job's `person`, lib/queue.ts).
 */
export class BotCheckError extends NotSentError {}

/**
 * Phase U: the employer sent the user an email to verify the account we just created (or a sign-in says it is not
 * verified yet). Nothing was sent; the run ends needs_input with a card, and the user's "Done" runs it again.
 */
export class AccountVerificationError extends Error {
  constructor(public company: string, public email: string) {
    super(`Verify your email for ${company}: open the email ${company} sent to ${email}, click its link, then press Done`);
  }
}

/** Phase U: the employer account cannot be used (a refused password, a sign-up refused). Nothing was sent; not retried. */
export class AccountError extends NoRetryError {}
