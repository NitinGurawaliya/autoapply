export type Tone = "success" | "info" | "warning" | "danger" | "neutral";

export type Outcome = {
  headline: string;
  /** What the user can do about it, in a sentence. Null when nothing is needed. */
  next: string | null;
  tone: Tone;
};

const BLOCKS: Record<string, Omit<Outcome, "tone">> = {
  min_match_score: { headline: "Match too low", next: "This role scored below your minimum match, so it was not applied to. Look for a closer role." },
  no_duplicate_role: { headline: "Already applied to this role", next: "A second application to the same role was blocked." },
  max_per_company_per_week: { headline: "Too many at this company", next: "You reached the weekly limit for this company. Try again later." },
  job_closed: { headline: "This job is closed", next: "The company has taken the posting down. Skip it." },
  max_in_flight: { headline: "Too many running at once", next: "Several of your applications are still running or waiting in line. Try again when some have finished." },
  unsafe_form_url: { headline: "Address not allowed", next: "The application address is not on a job board we apply through, so it was not opened. Open the posting yourself." },
  max_applications_per_day: { headline: "Daily limit reached", next: "You hit today's application limit. It resets at midnight UTC." },
  test_profile_mock_only: { headline: "Test profile", next: "Test profiles can only apply on the mock form." },
  board_not_supported: { headline: "Not supported yet", next: "We cannot apply on this job board yet. Open the posting and apply yourself." },
  profile_required: { headline: "Finish your profile first", next: "Complete onboarding, then try again." },
  allow_submit_on_real_sites: { headline: "Submitting is turned off", next: "Real submissions are switched off in the rules." },
};

const FAILURES: Array<[RegExp, (m: RegExpMatchArray) => Omit<Outcome, "tone">]> = [
  [/no longer open/i, () => ({ headline: "This job is closed", next: "The company has taken the posting down. Skip it." })],
  [/security code was not entered/i, () => ({ headline: "Security code not entered", next: "Retry, and enter the code Greenhouse emails you within 10 minutes." })],
  [/did not accept the security code/i, () => ({ headline: "Security code rejected", next: "Retry and use the newest email from Greenhouse." })],
  [/captcha|human check/i, () => ({ headline: "The job board asked for a human check", next: "Open the posting and submit it yourself." })],
  [/flagged as (possible )?spam|refused the application/i, () => ({ headline: "The job board rejected it as automated", next: "Open the posting and submit it yourself." })],
  [/does not take applications on its job board/i, () => ({ headline: "Apply on the company site", next: "This company lists the job here but takes applications on its own careers site. Open the posting and apply there." })],
  [/needs these filled before it will submit:\s*(.*)/i, (m) => ({ headline: "Some required questions were empty", next: `Nothing was sent. Answer: ${m[1].slice(0, 120)}, then retry.` })],
  [/rejected the form:\s*(.*)/i, (m) => ({ headline: "The form rejected some answers", next: `Check: ${m[1].slice(0, 120)}. Update those answers, then retry.` })],
  [/no confirmation appeared/i, () => ({ headline: "No confirmation seen", next: "We clicked Submit but never saw a confirmation. Check your email before retrying so you do not apply twice." })],
  [/worker stopped/i, () => ({ headline: "The worker stopped partway", next: "Retry it." })],
  [/saved answer for .* does not match/i, () => ({ headline: "A saved answer does not fit this form", next: "Update that answer, then retry." })],
  [/resume file is missing/i, () => ({ headline: "Your resume file needs uploading again", next: "It is missing or empty. Upload it again from Account and data, then retry." })],
  [/resume upload (failed|did not finish)/i, () => ({ headline: "Your resume would not upload", next: "The job board's upload stalled. Retry; if it happens again, check your resume file." })],
  [/adapter is not ready/i, () => ({ headline: "Not supported yet", next: "We cannot apply on this job board yet. Open the posting and apply yourself." })],
  [/no option "(.*)" for/i, (m) => ({ headline: "An answer did not match the form", next: `The form had no option "${m[1].slice(0, 60)}". Update that answer, then retry.` })],
  [/timeout|target page|closed|net::|err_/i, () => ({ headline: "The page did not load properly", next: "Retry. If it keeps failing, open the posting and apply yourself." })],
];

/** A plain-language description of where an application stands and what to do next. */
export function explainOutcome(status: string, error: string | null, waitingFor?: "code" | "answers" | null): Outcome {
  switch (status) {
    case "submitted":
      return { headline: "Submitted", next: null, tone: "success" };
    case "queued":
      return { headline: "In line", next: null, tone: "neutral" };
    case "inspecting":
      return { headline: "Reading the application form", next: null, tone: "info" };
    case "filling":
      return { headline: "Filling in the form", next: null, tone: "info" };
    case "needs_input":
      return waitingFor === "code"
        ? { headline: "Waiting for your security code", next: "Enter the code Greenhouse emailed you in the popup.", tone: "warning" }
        : { headline: "Waiting for your answer", next: "Answer the question in the popup and it continues.", tone: "warning" };
    case "pending_verification":
      return {
        headline: "Check your email",
        next: "Submit was pressed, but the job board did not confirm it. If the employer emailed you a confirmation, it was sent. If not, mark it not sent and retry.",
        tone: "warning",
      };
    case "cancelled":
      return { headline: "Cancelled", next: "Retry if you still want to apply.", tone: "neutral" };
    case "blocked": {
      const rule = (error ?? "").trim();
      const known = BLOCKS[rule];
      return known ? { ...known, tone: "danger" } : { headline: "Blocked by a rule", next: rule ? `Rule: ${rule}.` : null, tone: "danger" };
    }
    case "failed": {
      const message = error ?? "";
      for (const [pattern, build] of FAILURES) {
        const match = message.match(pattern);
        if (match) return { ...build(match), tone: "danger" };
      }
      return { headline: "Something went wrong", next: "Retry, or open the posting and apply yourself.", tone: "danger" };
    }
    default:
      return { headline: status, next: null, tone: "neutral" };
  }
}
