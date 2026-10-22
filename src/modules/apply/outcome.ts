import { NotSentError, RefusedError, WindowClosedError } from "./adapter";

// What a run does after an error, once a submission may have left (21 Oct: handoff windows that went away after Submit
// were recorded "not sent" and retried, and Techtorch was sent twice). Pure, so scripts/submit-guard-test.ts checks it.
//
//   before Submit was attempted   existing behaviour: retry while attempts remain, else failed
//   after, the board showed nothing was sent (NotSentError)   failed (the user may retry)
//   after, anything else (timeout, navigation, unexpected)   pending_verification: never retried automatically
//   handoff window closed with nothing sent   opened again once, then failed ("skip")

export type AfterError = "retry" | "failed" | "pending_verification" | "reopen" | "skip";

/** The event a run writes right before Submit is pressed (runner.ts markAttempted). */
export const SUBMIT_ATTEMPT = "submit_attempt";

/**
 * Whether the last run of an application got as far as pressing Submit: a "submit_attempt" event after its last
 * "start" rule check. Retry uses it for cancelled applications only (a failed one after Submit was proven not sent), so
 * one cancelled while its Submit may have gone out is never run again (lifecycle.ts).
 */
export function lastRunMaySendTwice(events: Array<{ type: string; rule: string | null; createdAt: Date }>) {
  const ordered = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let lastStart = -1;
  ordered.forEach((event, index) => {
    if (event.type === "rule_check" && event.rule === "start") lastStart = index;
  });
  return ordered.slice(lastStart + 1).some((event) => event.type === SUBMIT_ATTEMPT);
}

export function decideAfterError(input: {
  error: unknown;
  /** Submit may have been sent (SubmitContext.markAttempted was called). */
  attempted: boolean;
  handoff: boolean;
  /** The run had reached the Submit stage (the submit lock and rules passed). */
  submitStage: boolean;
  /** No page is left in the handoff window. */
  windowGone: boolean;
  reopenedBefore: boolean;
  retryable: boolean;
  attempt: number;
  maxAttempts: number;
}): AfterError {
  const { error, attempted } = input;
  // A handoff window that sent its submission (the person may press Submit at any time, even before the agent is ready)
  // is never reopened or failed: whatever went wrong after, it may have arrived (21 Oct: Sarvam AI, Matter Labs).
  // The one exception: the board said on the page that it refused it, so nothing was sent (21 Oct: Wisdom AI).
  if (input.handoff && attempted) return error instanceof RefusedError ? "failed" : "pending_verification";
  const closedBeforeSubmit = error instanceof WindowClosedError || (!attempted && !input.submitStage && input.windowGone);
  if (input.handoff && closedBeforeSubmit) return input.reopenedBefore ? "skip" : "reopen";
  if (attempted) return error instanceof NotSentError ? "failed" : "pending_verification";
  return input.retryable && input.attempt < input.maxAttempts ? "retry" : "failed";
}
