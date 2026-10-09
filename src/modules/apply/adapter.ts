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
};

export interface AtsAdapter {
  source: "greenhouse" | "lever" | "ashby" | "mock";
  matches(url: string): boolean;
  /** URL of the actual application form, when the listing URL is not the form itself. */
  formUrl?(job: { applyUrl: string; externalId: string; companySlug: string }): string;
  inspect(page: Page): Promise<FormField[]>;
  /** The ATS parses the resume on upload and fills fields from it, so upload first and fill after, so ours win. */
  uploadFirst?: boolean;
  /** Attach a file the way this ATS expects; returns a cleanup that deletes the temp file. Defaults to setInputFiles. */
  uploadFile?(page: Page, value: ResolvedValue, bytes: Uint8Array): Promise<() => Promise<void>>;
  fill(page: Page, values: ResolvedValue[]): Promise<FilledField[]>;
  submit(page: Page, ctx: SubmitContext): Promise<SubmitResult>;
}

/** Thrown mid-fill when a saved answer does not fit the form's live options; the runner asks the user instead of failing. */
export class NeedsAnswerError extends Error {
  constructor(public question: PendingQuestion) {
    super(`No matching option for "${question.label}"`);
  }
}

/** Thrown once a submit may have reached the employer; the runner must not retry and risk a duplicate application. */
export class NoRetryError extends Error {}
