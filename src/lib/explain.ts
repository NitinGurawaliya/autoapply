// What an application's outcome means to the user, in the agent's voice (24 Oct, owner): no rule names, worker or
// pipeline words, and no raw page text; only what happened and what to do next.

export type Tone = "success" | "info" | "warning" | "danger" | "neutral";

export type Outcome = {
  headline: string;
  /** What the user can do about it, in a sentence. Null when nothing is needed. */
  next: string | null;
  tone: Tone;
};

const BLOCKS: Record<string, Omit<Outcome, "tone">> = {
  min_match_score: { headline: "Not a close enough match", next: "Your agent skipped this one because it fits your profile too loosely. Look for a closer role." },
  no_duplicate_role: { headline: "Already applied to this role", next: "Your agent doesn't apply to the same role twice." },
  max_per_company_per_week: { headline: "Enough applications to this company", next: "Your agent has applied here several times this week. Try again next week." },
  job_closed: { headline: "This job is closed", next: "The company has taken the posting down. Skip it." },
  max_in_flight: { headline: "Your agent is busy", next: "Several applications are still on the way. Try again when some have finished." },
  unsafe_form_url: { headline: "Apply on the company site", next: "This form isn't on a job board your agent applies through. Open the posting and apply yourself." },
  max_applications_per_day: { headline: "That's all for today", next: "Your agent has sent today's applications. It starts again at midnight UTC." },
  test_profile_mock_only: { headline: "Test profile", next: "A test profile can only apply on the practice form." },
  board_not_supported: { headline: "Apply on the posting", next: "Your agent can't apply on this job board yet. Open the posting and apply yourself." },
  profile_required: { headline: "Finish your profile first", next: "Your agent needs your profile to apply. Complete it, then try again." },
  allow_submit_on_real_sites: { headline: "Sending is paused", next: "Your agent isn't sending applications right now. Try again later." },
};

const FAILURES: Array<[RegExp, (m: RegExpMatchArray) => Omit<Outcome, "tone">]> = [
  [/no longer open/i, () => ({ headline: "This job is closed", next: "The company has taken the posting down. Skip it." })],
  [/security code was not entered/i, () => ({ headline: "The security code didn't arrive in time", next: "Retry, and enter the code the job board emails you within 10 minutes." })],
  [/did not accept the security code/i, () => ({ headline: "The security code didn't work", next: "Retry and use the newest code from your email." })],
  [/captcha|human check|bot check/i, () => ({ headline: "The job board wanted a person", next: "Open the posting and submit it yourself." })],
  [/flagged as (possible )?spam|refused the application|couldn.t submit your application/i, () => ({ headline: "The job board didn't accept it", next: "Open the posting and submit it yourself." })],
  [/does not take applications on its job board/i, () => ({ headline: "Apply on the company site", next: "This company takes applications on its own careers site. Open the posting and apply there." })],
  [/needs these filled before it will submit:\s*(.*)/i, (m) => ({ headline: "A few questions need you", next: `Nothing was sent. Answer: ${m[1].slice(0, 120)}, then retry.` })],
  [/rejected the form:\s*(.*)/i, (m) => ({ headline: "The form didn't accept some answers", next: `Check: ${m[1].slice(0, 120)}. Update those answers, then retry.` })],
  [/no confirmation appeared/i, () => ({ headline: "No confirmation yet", next: "Your agent pressed Submit but didn't see a confirmation. Check your email before retrying so you don't apply twice." })],
  [/worker stopped/i, () => ({ headline: "Your agent was interrupted", next: "Nothing was sent. Retry it." })],
  [/saved answer for .* does not match/i, () => ({ headline: "A saved answer doesn't fit this form", next: "Update that answer, then retry." })],
  [/resume file is missing/i, () => ({ headline: "Your resume needs uploading again", next: "It is missing or empty. Upload it again from Account and data, then retry." })],
  [/resume upload (failed|did not finish)/i, () => ({ headline: "Your resume wouldn't upload", next: "Retry; if it happens again, check your resume file." })],
  [/adapter is not ready/i, () => ({ headline: "Apply on the posting", next: "Your agent can't apply on this job board yet. Open the posting and apply yourself." })],
  [/no option "(.*)" for/i, (m) => ({ headline: "An answer didn't match the form", next: `The form had no option "${m[1].slice(0, 60)}". Update that answer, then retry.` })],
  [/timeout|target page|closed|net::|err_/i, () => ({ headline: "The job board's page didn't load", next: "Retry. If it keeps happening, open the posting and apply yourself." })],
];

/** A plain-language description of where an application stands and what to do next. */
export function explainOutcome(status: string, error: string | null, waitingFor?: "code" | "answers" | null): Outcome {
  switch (status) {
    case "submitted":
      return { headline: "Sent", next: null, tone: "success" };
    case "queued":
      return { headline: "Getting ready to apply", next: null, tone: "neutral" };
    case "inspecting":
      return { headline: "Reading the application form", next: null, tone: "info" };
    case "filling":
      return { headline: "Writing your answers", next: null, tone: "info" };
    case "needs_input":
      return waitingFor === "code"
        ? { headline: "Your agent needs your security code", next: "Enter the code the job board emailed you, and your agent carries on.", tone: "warning" }
        : { headline: "Your agent needs an answer from you", next: "Answer the question, and your agent carries on.", tone: "warning" };
    case "pending_verification":
      return {
        headline: "Check your email",
        next: "Your agent pressed Submit, but the job board didn't confirm it. If the employer emailed you a confirmation, it was sent. If not, mark it not sent and retry.",
        tone: "warning",
      };
    case "cancelled":
      return { headline: "Cancelled", next: "Retry if you still want to apply.", tone: "neutral" };
    case "blocked": {
      const known = BLOCKS[(error ?? "").trim()];
      // A rule we have no words for yet is still never named on screen.
      return known ? { ...known, tone: "danger" } : { headline: "Your agent held this one back", next: "It didn't apply. Retry later, or open the posting and apply yourself.", tone: "danger" };
    }
    case "failed": {
      const message = error ?? "";
      for (const [pattern, build] of FAILURES) {
        const match = message.match(pattern);
        if (match) return { ...build(match), tone: "danger" };
      }
      return { headline: "Your agent couldn't send this one", next: "Retry, or open the posting and apply yourself.", tone: "danger" };
    }
    default:
      return { headline: "Didn't go through", next: null, tone: "neutral" };
  }
}
