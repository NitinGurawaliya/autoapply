// The cross-run duplicate-submission guard (apply/outcome.ts, 21 Oct): once Submit may have gone out, nothing retries
// the application automatically; an unconfirmed outcome is pending_verification until the user says which it was.
// Part A is pure. Part B uses the test profile and the mock job only, opens no browser, and deletes what it creates.
// npx tsx scripts/submit-guard-test.ts
import { db } from "../src/lib/db";
import { APPLY_QUEUES, HANDOFF_BOARDS, HANDOFF_QUEUE, PERSON_QUEUE, queueFor, UNPROTECTED_QUEUE } from "../src/lib/queue";
import { MaybeSentError, NoRetryError, NotSentError, RefusedError, WindowClosedError } from "../src/modules/apply/adapter";
import { retryApplication, resolveVerification } from "../src/modules/apply/lifecycle";
import { decideAfterError, lastRunMaySendTwice, SUBMIT_ATTEMPT } from "../src/modules/apply/outcome";
import { recordAfterSubmit } from "../src/modules/apply/runner";
import { historyFor } from "../src/modules/governance";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const base = { attempted: false, handoff: false, submitStage: false, windowGone: false, reopenedBefore: false, retryable: true, attempt: 1, maxAttempts: 2 };
const decide = (over: Partial<typeof base> & { error: unknown }) => decideAfterError({ ...base, ...over });

// A. Pure decisions.
// Errors before Submit: the existing behaviour.
check("before Submit, a timeout is retried while attempts remain", decide({ error: new Error("page.goto: Timeout 30000ms exceeded") }) === "retry");
check("before Submit, the last attempt fails", decide({ error: new Error("net::ERR_CONNECTION_RESET"), attempt: 2 }) === "failed");
check("before Submit, a no-retry error fails", decide({ error: new NoRetryError("This job is no longer open."), retryable: false }) === "failed");

// Errors after a Submit that may have gone out.
check("after Submit, a timeout is pending_verification", decide({ error: new Error("locator.waitFor: Timeout 15000ms exceeded"), attempted: true }) === "pending_verification");
check("after Submit, a navigation failure is pending_verification", decide({ error: new Error("page.goto: net::ERR_ABORTED"), attempted: true }) === "pending_verification");
check("after Submit, an unexpected error is pending_verification", decide({ error: new TypeError("Cannot read properties of null"), attempted: true }) === "pending_verification");
check("after Submit, no confirmation (MaybeSentError) is pending_verification", decide({ error: new MaybeSentError("Submit clicked but no confirmation appeared."), attempted: true }) === "pending_verification");
check("after Submit, a generic no-retry error is still pending_verification", decide({ error: new NoRetryError("something odd"), attempted: true, retryable: false }) === "pending_verification");

// After Submit, the board showed nothing was sent.
check("after Submit, a CAPTCHA (NotSentError) fails so the user may retry", decide({ error: new NotSentError("Ashby showed a CAPTCHA."), attempted: true }) === "failed");
check("after Submit, a spam refusal (NotSentError) fails", decide({ error: new NotSentError("Ashby refused the application as possible spam."), attempted: true, retryable: false }) === "failed");

// Handoff windows.
check("handoff: window closed with nothing sent opens again", decide({ error: new WindowClosedError("closed"), handoff: true, submitStage: true, windowGone: true }) === "reopen");
check("handoff: closed a second time is a skip", decide({ error: new WindowClosedError("closed"), handoff: true, submitStage: true, windowGone: true, reopenedBefore: true }) === "skip");
check("handoff: window gone after a submission left is pending_verification, never reopened", decide({ error: new MaybeSentError("may have been sent"), handoff: true, submitStage: true, windowGone: true, attempted: true }) === "pending_verification");
check("handoff: a submission seen before the agent was ready, then the window closed, is pending_verification, never reopened", decide({ error: new WindowClosedError("closed"), handoff: true, windowGone: true, attempted: true }) === "pending_verification");
check("handoff: a submission seen, then 'not pressed in time', is pending_verification, never failed", decide({ error: new NotSentError("Submit was not pressed within 15 minutes."), handoff: true, submitStage: true, attempted: true }) === "pending_verification");
check("handoff: a spam refusal shown on the page after the person's Submit fails (nothing sent, retry allowed)", decide({ error: new RefusedError("Ashby refused the application as possible spam"), handoff: true, submitStage: true, attempted: true }) === "failed");
check("handoff: window gone before the Submit stage opens again", decide({ error: new Error("Target page, context or browser has been closed"), handoff: true, windowGone: true }) === "reopen");

// No automatic retry or reopen can follow a possible submission, whatever the error and settings.
const errors = [new Error("x"), new TypeError("x"), new NoRetryError("x"), new MaybeSentError("x"), new NotSentError("x"), new WindowClosedError("x")];
let unsafe = 0;
for (const error of errors)
  for (const handoff of [false, true])
    for (const submitStage of [false, true])
      for (const windowGone of [false, true])
        for (const retryable of [false, true])
          for (const attempt of [1, 2]) {
            const next = decide({ error, attempted: true, handoff, submitStage, windowGone, retryable, attempt });
            // A WindowClosedError is thrown only when no request left the window, so a reopen there sends nothing twice.
            if (next === "retry" || (next === "reopen" && !(error instanceof WindowClosedError))) unsafe += 1;
          }
check("no automatic retry or reopen after a possible submission (all 192 combinations)", unsafe === 0, `${unsafe} unsafe`);

// Routing: a person presses Submit on Ashby, so its applications go to the queue only a worker with a screen takes.
check("Ashby applications go to the handoff queue", queueFor("ashby") === HANDOFF_QUEUE);
check("Greenhouse, Lever and mock applications go to the normal queue", ["greenhouse", "lever", "mock"].every((source) => queueFor(source) === "apply"));
check("an application whose board is unknown goes to the normal queue", queueFor(undefined) === "apply");
check("Ashby at protection none goes to the queue a Docker worker takes", queueFor("ashby", "job_apply_none") === UNPROTECTED_QUEUE);
check("Ashby at low, medium, high or an unseen level goes to the screen queue", ["job_apply_low", "job_apply_medium", "job_apply_high", "job_apply_very_high"].every((level) => queueFor("ashby", level) === HANDOFF_QUEUE));
check("Ashby with an unread level goes to the screen queue", queueFor("ashby", null) === HANDOFF_QUEUE && queueFor("ashby", undefined) === HANDOFF_QUEUE);
check("a level never moves Greenhouse or Lever off the normal queue", queueFor("greenhouse", "job_apply_none") === "apply" && queueFor("lever", "job_apply_high") === "apply");
check("every apply queue is read by code that cancels or reaps apply jobs", ["apply", HANDOFF_QUEUE, UNPROTECTED_QUEUE, PERSON_QUEUE].every((queue) => APPLY_QUEUES.includes(queue)));
check("handoff boards are exactly Ashby", HANDOFF_BOARDS.length === 1 && HANDOFF_BOARDS[0] === "ashby");

// The last run's Submit attempt, read from events (for a cancelled application's Retry).
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 21, 10, 0, seconds));
const start = (s: number) => ({ type: "rule_check", rule: "start", createdAt: at(s) });
const pressed = (s: number) => ({ type: SUBMIT_ATTEMPT, rule: null, createdAt: at(s) });
const other = (s: number) => ({ type: "fill", rule: null, createdAt: at(s) });
check("a Submit attempt in the last run counts", lastRunMaySendTwice([start(1), other(2), pressed(3)]));
check("a Submit attempt in an earlier run only does not count", !lastRunMaySendTwice([start(1), pressed(2), start(3), other(4)]));
check("no Submit attempt does not count", !lastRunMaySendTwice([start(1), other(2)]));
check("events out of order are sorted first", lastRunMaySendTwice([pressed(5), other(2), start(1)]));

// B. The database side, on the test profile and the mock job.
async function partB() {
  const user = await db.user.findUnique({ where: { email: "t12-check@swipeapply.local" } });
  const job = await db.job.findUnique({ where: { source_externalId: { source: "mock", externalId: "greenhouse" } } });
  if (!user || !job) {
    check("test profile and mock job exist", false);
    return;
  }
  const created: string[] = [];
  try {
    const pending = await db.application.create({ data: { userId: user.id, jobId: job.id, status: "pending_verification", error: "test: may have been sent", fields: [], pendingQuestions: [] } });
    created.push(pending.id);
    const retry = await retryApplication(pending.id, user.id);
    check("a pending_verification application cannot be retried", !retry.ok && retry.reason === "not_retryable", JSON.stringify(retry));
    const history = await historyFor(user.id, { title: job.title, companyId: job.companyId });
    check("a pending_verification application blocks a second application to the same role", history.duplicateRole);

    check("only the owner can settle it", (await resolveVerification(pending.id, "someone-else", true)) === "not_found");
    check("the user confirming the email marks it submitted", (await resolveVerification(pending.id, user.id, true)) === "submitted");
    const sent = await db.application.findUnique({ where: { id: pending.id } });
    check("submitted with a time and no error", sent?.status === "submitted" && Boolean(sent.submittedAt) && sent.error === null, sent?.status);
    check("a settled application cannot be settled again", (await resolveVerification(pending.id, user.id, false)) === "not_pending");

    check("confirmed sent keeps the time the outcome became uncertain", sent?.submittedAt?.getTime() === pending.updatedAt.getTime(), `${sent?.submittedAt?.toISOString()} vs ${pending.updatedAt.toISOString()}`);

    const second = await db.application.create({ data: { userId: user.id, jobId: job.id, status: "pending_verification", error: "test", fields: [], pendingQuestions: [] } });
    created.push(second.id);
    check("the user saying it was not sent marks it failed", (await resolveVerification(second.id, user.id, false)) === "failed");
    const notSent = await db.application.findUnique({ where: { id: second.id } });
    check("failed is a status Retry accepts (the retry itself is not run here: it would queue the mock form)", notSent?.status === "failed");

    // A cancel while the board may be receiving it: the outcome is recorded over the cancel.
    const cancelled = await db.application.create({ data: { userId: user.id, jobId: job.id, status: "cancelled", error: "Cancelled by you", fields: [], pendingQuestions: [] } });
    created.push(cancelled.id);
    await recordAfterSubmit(cancelled.id, { status: "pending_verification", error: "test: may have been sent" });
    check("pending_verification is recorded over a cancel", (await db.application.findUnique({ where: { id: cancelled.id } }))?.status === "pending_verification");
    const sentOverCancel = await db.application.create({ data: { userId: user.id, jobId: job.id, status: "cancelled", fields: [], pendingQuestions: [] } });
    created.push(sentOverCancel.id);
    await recordAfterSubmit(sentOverCancel.id, { status: "submitted", submittedAt: new Date(), error: null });
    check("a confirmed submit is recorded over a cancel", (await db.application.findUnique({ where: { id: sentOverCancel.id } }))?.status === "submitted");
    await recordAfterSubmit(sentOverCancel.id, { status: "pending_verification" });
    check("a submitted application is never changed by a later outcome", (await db.application.findUnique({ where: { id: sentOverCancel.id } }))?.status === "submitted");

    // Cancelled after its Submit may have gone out, and the run never recorded it: Retry asks the user instead.
    const cancelledAfterPress = await db.application.create({ data: { userId: user.id, jobId: job.id, status: "cancelled", error: "Cancelled by you", fields: [], pendingQuestions: [] } });
    created.push(cancelledAfterPress.id);
    await db.applicationEvent.createMany({
      data: [
        { applicationId: cancelledAfterPress.id, type: "rule_check", rule: "start", message: "start passed", createdAt: new Date(Date.now() - 60_000) },
        { applicationId: cancelledAfterPress.id, type: SUBMIT_ATTEMPT, message: "test", createdAt: new Date(Date.now() - 30_000) },
      ],
    });
    const blocked = await retryApplication(cancelledAfterPress.id, user.id);
    const after = await db.application.findUnique({ where: { id: cancelledAfterPress.id } });
    check("Retry of a cancel after Submit was pressed is refused and asks the user", !blocked.ok && blocked.reason === "not_retryable" && after?.status === "pending_verification", `${JSON.stringify(blocked)} ${after?.status}`);
  } finally {
    if (created.length) {
      await db.applicationEvent.deleteMany({ where: { applicationId: { in: created } } });
      await db.application.deleteMany({ where: { id: { in: created } } });
    }
  }
}

partB()
  .catch((error) => check("part B ran", false, error instanceof Error ? error.message.slice(0, 120) : "error"))
  .finally(async () => {
    await db.$disconnect();
    console.log(failed === 0 ? "PASS submit-guard" : `FAIL submit-guard (${failed})`);
    process.exit(failed === 0 ? 0 : 1);
  });
