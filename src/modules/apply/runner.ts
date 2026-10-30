import { listingState } from "@/modules/jobs";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueApply, HANDOFF_BOARDS, PERSON_HANDOFF } from "@/lib/queue";
import { storage } from "@/lib/storage";
import { notifyNeedsInput } from "@/lib/notify";
import { ONE_TIME_CODE_KEY } from "@/modules/answers";
import { check, loadRules, writeEvent } from "@/modules/governance";
import { BotCheckError, MaybeSentError, NeedsAnswerError, NoRetryError, type FilledField, type PendingQuestion } from "./adapter";
import { decideAfterError, SUBMIT_ATTEMPT } from "./outcome";
import { uploadResume } from "./adapters/mock";
import { livePage, openBrowser } from "./browser";
import { boardSupported } from "./lifecycle";
import { pickAdapter } from "./pick";
import { jobQuestions, questionsCached } from "./questions";
import { resolveForm } from "./resolveForm";
import { formUrlAllowed } from "./urls";
import { LockStopped, withSubmitLock } from "./submitLock";
import { sendPush } from "@/lib/push";

/** The user (or a queue clear) cancelled this application while it was running. */
export class CancelledError extends Error {
  constructor() {
    super("Application was cancelled");
  }
}

// Every status write goes through here, so a cancel can never be overwritten by a run that is still going.
async function setApp(applicationId: string, data: Prisma.ApplicationUpdateManyMutationInput) {
  // A run never writes over a cancel, a confirmed submission or one that may have been sent (21 Oct: an old run wrote
  // "failed" over Sarvam AI after it had been confirmed sent). The run then stops as if cancelled.
  const result = await db.application.updateMany({ where: { id: applicationId, status: { notIn: ["cancelled", "submitted", "pending_verification"] } }, data });
  if (result.count === 0) throw new CancelledError();
}

/**
 * Records an outcome once Submit may have gone out (submitted or pending_verification), even over a cancel: the user
 * may press Cancel while the board receives it, and an application left "cancelled" could be retried and sent twice.
 */
export async function recordAfterSubmit(applicationId: string, data: Prisma.ApplicationUpdateManyMutationInput) {
  await db.application.updateMany({ where: { id: applicationId, status: { in: ["queued", "inspecting", "filling", "needs_input", "cancelled"] } }, data });
}

async function block(applicationId: string, rule: string, message: string) {
  await writeEvent(applicationId, "block", message, rule);
  await setApp(applicationId, { status: "blocked", error: rule });
}

export const CODE_WAIT_MS = 10 * 60 * 1000;

// The only time the runner holds a browser while waiting on the user: an emailed code is tied to this browser session.
export function codeRequester(applicationId: string) {
  return async (prompt: string) => {
    await setApp(applicationId, {
      status: "needs_input",
      verificationCode: null,
      pendingQuestions: [{ key: ONE_TIME_CODE_KEY, label: prompt, type: "text", required: true }],
    });
    await writeEvent(applicationId, "ask_user", "Waiting for the emailed security code");
    void notifyNeedsInput(applicationId, "code");
    const deadline = Date.now() + CODE_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const row = await db.application.findUnique({ where: { id: applicationId }, select: { verificationCode: true, status: true } });
      if (!row || row.status === "cancelled") throw new CancelledError();
      if (row.verificationCode) {
        await setApp(applicationId, { verificationCode: null, status: "filling", pendingQuestions: [] });
        await writeEvent(applicationId, "resolve", "Security code received");
        return row.verificationCode;
      }
    }
    await setApp(applicationId, { pendingQuestions: [] });
    return null;
  };
}

/** `person`: the board already asked for a person on this application (lib/queue.ts PERSON_QUEUE). */
export async function runApplication(applicationId: string, options: { person?: boolean } = {}) {
  try {
    await execute(applicationId, options);
  } catch (error) {
    if (error instanceof CancelledError) return;
    throw error;
  }
}

// Screenshots as JPEG: a full-page PNG of a confirmation page was 0.9 MB (16 Oct QA); text stays readable at this quality.
const SHOT = { type: "jpeg" as const, quality: 72 };

/**
 * What the job board showed after Submit, as proof of the confirmation (owner, 16 Oct: some companies send no email, so
 * this is the only record). Taken after the application is recorded as sent; never blocks or undoes that.
 */
async function captureConfirmation(page: Awaited<ReturnType<typeof openBrowser>>["page"], applicationId: string, attempt: number, userId: string) {
  if (page.isClosed()) return;
  try {
    const shot = await page.screenshot({ ...SHOT, fullPage: true, timeout: 10000 });
    const key = `screenshots/${applicationId}/sent-${attempt}.jpg`;
    await storage.put(key, new Uint8Array(shot), "image/jpeg", userId);
    await writeEvent(applicationId, "screenshot", key);
  } catch {
    /* the page closed after confirming; the confirmation text is already recorded */
  }
}

// Handoff: how long the board's Success stays on screen before the window closes itself, and the event that marks a
// window opened again after the user closed it before Submit.
const HANDOFF_SUCCESS_SHOWN_MS = 3000;
const WINDOW_REOPENED = "The window was closed before Submit, so it opened again";

/** What the page looked like when a run failed, so "why" is an answer and not a guess. Never blocks the failure path. */
async function captureFailure(session: Awaited<ReturnType<typeof openBrowser>> | null, applicationId: string, attempt: number, userId: string) {
  const page = session?.page;
  if (!page || page.isClosed()) return;
  try {
    const shot = await page.screenshot({ ...SHOT, fullPage: true, timeout: 10000 });
    const key = `screenshots/${applicationId}/fail-${attempt}.jpg`;
    await storage.put(key, new Uint8Array(shot), "image/jpeg", userId);
    await writeEvent(applicationId, "screenshot", key);
    // Only lines that look like messages from the site, never form values.
    const lines = (await page.locator("body").innerText({ timeout: 5000 })).split(String.fromCharCode(10)).map((line) => line.trim());
    const notes = lines.filter((line) => line.length < 160 && /error|required|invalid|spam|captcha|try again|something went wrong|not found|unable/i.test(line)).slice(0, 6);
    if (notes.length > 0) await writeEvent(applicationId, "diagnostic", `Page said: ${notes.join(" | ")}`.slice(0, 400));
  } catch {
    /* the page is gone; the error message already says what happened */
  }
}

async function execute(applicationId: string, options: { person?: boolean }) {
  const application = await db.application.findUnique({ where: { id: applicationId } });
  if (!application) throw new Error("Application not found");
  if (["submitted", "blocked", "cancelled"].includes(application.status)) return;

  const [job, profile, answers] = await Promise.all([
    db.job.findUnique({ where: { id: application.jobId }, include: { company: { select: { slug: true, name: true } } } }),
    db.profile.findUnique({ where: { userId: application.userId } }),
    db.answer.findMany({ where: { userId: application.userId } }),
  ]);
  if (!job || !profile) {
    await block(applicationId, "profile_required", "Profile or job is missing");
    return;
  }
  // A board switched off in APPLY_BOARDS never runs, even for an application queued or answered before it was switched off.
  if (!boardSupported(job.source)) {
    await block(applicationId, "board_not_supported", `Applying on ${job.source} is switched off for now`);
    return;
  }

  const rules = loadRules();
  const attempt = application.attempt + 1;
  await setApp(applicationId, { attempt, status: "inspecting" });

  // The reaper treats a running application whose heartbeat stops as belonging to a dead worker.
  const touch = () => db.application.updateMany({ where: { id: applicationId, status: { not: "cancelled" } }, data: { heartbeatAt: new Date() } }).catch(() => undefined);

  const adapter = pickAdapter(job.applyUrl, job.source);
  const formUrl = adapter.formUrl?.({ applyUrl: job.applyUrl, externalId: job.externalId, companySlug: job.company.slug }) ?? job.applyUrl;
  if (!formUrlAllowed(formUrl, adapter.source)) {
    await block(applicationId, "unsafe_form_url", `Refused to open ${new URL(formUrl, "http://invalid").host} for a ${adapter.source} job`);
    return;
  }
  const started = await check("start", { applicationId, profileExists: true, isTest: profile.isTest, adapterSource: adapter.source });
  if (!started.ok) {
    await setApp(applicationId, { status: "blocked", error: started.rule });
    return;
  }
  if (profile.isTest && adapter.source !== "mock") {
    await block(applicationId, "test_profile_mock_only", "Test profiles can only apply on the mock form");
    return;
  }
  // A missing resume file cannot be fixed by trying again: say so before any browser opens (16 Oct QA: it was found
  // only after the form was filled, and the run was retried).
  // An empty file counts as missing: Greenhouse waits forever on a 0-byte upload (18 Oct: 7 runs of one user, each
  // tried twice, all stopped at "upload did not finish").
  const resumeFile = await storage.get(profile.resumeKey);
  if (!resumeFile || resumeFile.bytes.length === 0) {
    const message = "Resume file is missing or empty. Upload it again from Account, then retry.";
    await writeEvent(applicationId, "error", message);
    await setApp(applicationId, { status: "failed", error: message, attempt: application.attempt });
    return;
  }

  await touch();
  const heartbeat = setInterval(() => void touch(), 30_000);
  let session: Awaited<ReturnType<typeof openBrowser>> | null = null;
  // Held in an object because it is assigned from inside a closure.
  const upload: { cleanup: (() => Promise<void>) | null } = { cleanup: null };
  const jobInfo = { company: job.company.name, title: job.title, location: job.location, country: job.country, description: job.description };
  const resolveLog = async (message: string, data?: Record<string, unknown>) => {
    await writeEvent(applicationId, "resolve", message, undefined, data as Prisma.InputJsonValue | undefined);
  };
  // A saved answer only proves a loop when the user gave it in reply to THIS application's own prompt and the form
  // still refuses it. An older answer (the same question on another company's form, with other options, such as
  // "How did you hear about this job?") is simply asked again with this form's options; the new answer replaces it.
  // A question the user already answered for this application that is still pending: the answer did not fit the form.
  // It is asked again with the form's own choices (until the user has answered it MAX_ANSWERS times); only then does the run give up, so a
  // wording mismatch costs one more tap instead of the application (6 runs failed this way in the week to 10 Oct).
  // Answered by the user on this application this many times (since the last Retry) and still not usable: give up.
  const MAX_ANSWERS = 2;
  // Counts the user's own answers to that question here ("answer" events carry the question keys), not every ask: asks
  // for other questions, or from an earlier attempt, are no sign that this answer does not fit (21 Oct: fonio and Colonist
  // failed on their first real answer after asks from 17 Oct and asks for other questions were counted).
  const repeatedQuestion = async (pending: PendingQuestion[]) => {
    const lastRetry = await db.applicationEvent.findFirst({ where: { applicationId, type: "retry", message: { startsWith: "Retried by you" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const answered = await db.applicationEvent.findMany({ where: { applicationId, type: "answer", ...(lastRetry ? { createdAt: { gt: lastRetry.createdAt } } : {}) }, select: { data: true } });
    const times = (key: string) => answered.filter((event) => ((event.data as { keys?: unknown } | null)?.keys as unknown[] | undefined)?.includes(key)).length;
    return pending.find((question) => times(question.key) >= MAX_ANSWERS);
  };
  // Greenhouse and the other boards: the form opens while its published questions are worked out (about 5 s a run,
  // 18 Oct). If a question needs the user, that browser is closed before the run stops, never held open while waiting.
  // A handoff board opens its window only once the answers are ready, so nothing is opened early for it.
  // The browser is open for inspect, fill and submit only (T100): when the job's questions are already on its row they
  // are answered first, with no browser open, and the form opens after; only questions still to be fetched overlap it.
  // A person presses Submit on handoff boards (lib/queue.ts HANDOFF_BOARDS: Ashby), in a visible window opened when the
  // form is ready (adapters/ashby.ts waitForUserSubmit); other boards submit by themselves.
  const handoff = HANDOFF_BOARDS.includes(adapter.source);
  const early = !handoff && !questionsCached(job) ? openBrowser(formUrl, application.userId, { handoff: false, window: adapter.window }) : null;
  let submitting = false;
  // Set by the adapter right before Submit is pressed (outcome.ts): from then on a failure is never retried automatically.
  let attempted = false;
  // The submit was confirmed and recorded: nothing after it changes the status.
  let confirmedSent = false;
  // From here the application may have been sent: no automatic retry (outcome.ts). Kept on the record so a later Retry
  // (a cancel after this point) knows it too (lifecycle.ts).
  const markAttempted = async () => {
    if (attempted) return;
    attempted = true;
    await writeEvent(applicationId, SUBMIT_ATTEMPT, "Submit is being pressed: from here the application may have been sent").catch(() => undefined);
  };
  let stopWatchingSubmit: (() => void) | undefined;
  early?.catch(() => undefined);
  try {
    // Ask before opening the form (T56): when the board publishes the form's questions, run the same answering chain on
    // them first; anything genuinely missing is asked now, with no browser open and no half-filled form. Essays the run
    // will draft do not count as missing. If the questions cannot be read, the run asks mid-form as before.
    const known = await jobQuestions(job);
    if (known && known.length > 0) {
      const before = await resolveForm({ userId: application.userId, source: adapter.source, fields: known, profile, answers, job: jobInfo, draftEssays: false, log: async (message, data) => resolveLog(`Before opening the form: ${message}`, data) });
      if (before.missing.length > 0) {
        const repeatedEarly = await repeatedQuestion(before.missing);
        if (repeatedEarly) {
          const message = `You answered ${MAX_ANSWERS} times, but your answer for "${repeatedEarly.label.slice(0, 80)}" still does not match this form's options`;
          await writeEvent(applicationId, "error", message);
          await setApp(applicationId, { status: "failed", error: message, attempt: application.attempt });
          return;
        }
        await setApp(applicationId, { status: "needs_input", attempt: application.attempt, pendingQuestions: before.missing as Prisma.InputJsonValue });
        await writeEvent(applicationId, "ask_user", `Need ${before.missing.length} answers before opening the form`);
        if (early) session = await early.catch(() => null); // closed in finally
        void notifyNeedsInput(applicationId, "answers");
        return;
      }
      await writeEvent(applicationId, "resolve", "Every question on the form can be answered; opening it");
    }
    session = early ? await early : await openBrowser(formUrl, application.userId, { handoff, window: adapter.window });
    // A handoff window is the person's from the moment it opens: a Submit pressed before the agent is ready still counts.
    if (handoff) stopWatchingSubmit = adapter.watchSubmit?.(session.page, () => void markAttempted());
    const fields = await adapter.inspect(session.page);
    await writeEvent(applicationId, "inspect", `Found ${fields.length} fields`);
    const { resolved } = await resolveForm({ userId: application.userId, source: adapter.source, fields, profile, answers, job: jobInfo, draftEssays: true, log: resolveLog });
    await writeEvent(applicationId, "resolve", `Resolved ${resolved.values.length}, pending ${resolved.pending.length}`);
    const repeated = await repeatedQuestion(resolved.pending);
    if (repeated) {
      const message = `You answered ${MAX_ANSWERS} times, but your answer for "${repeated.label.slice(0, 80)}" still does not match this form's options`;
      await writeEvent(applicationId, "error", message);
      await setApp(applicationId, { status: "failed", error: message, attempt: application.attempt });
      return;
    }
    if (resolved.pending.length > 0) {
      await setApp(applicationId, {
        status: "needs_input",
        // Pausing for the user is not a failed attempt.
        attempt: application.attempt,
        pendingQuestions: resolved.pending as Prisma.InputJsonValue,
      });
      await writeEvent(applicationId, "ask_user", `Need ${resolved.pending.length} answers`);
      void notifyNeedsInput(applicationId, "answers");
      return;
    }

    await setApp(applicationId, { status: "filling" });
    const textValues = resolved.values.filter((value) => value.type !== "file");
    const resume = resolved.values.find((value) => value.type === "file");
    const uploadNow = async () => {
      if (!resume) return;
      // Read once, at the start of the run (resumeFile), and checked there to be neither missing nor empty.
      const stored = resumeFile;
      upload.cleanup = adapter.uploadFile
        ? await adapter.uploadFile(session!.page, resume, stored.bytes)
        : await uploadResume(session!.page, resume, stored.bytes);
    };
    // Some ATSs read the resume on upload and fill fields from it; uploading first lets our own values win.
    if (adapter.uploadFirst) await uploadNow();
    const filled: FilledField[] = await adapter.fill(session.page, textValues);
    if (!adapter.uploadFirst) await uploadNow();
    if (resume) {
      filled.push({
        key: resume.key,
        label: resume.label,
        value: resume.fileName ?? "resume.pdf",
        source: resume.source,
        selector: resume.selector,
      });
    }
    // Keep why each value was chosen (a reused answer's original question) with the field and its event.
    const basisBySelector = new Map(resolved.values.map((value) => [value.selector, value.basis]));
    for (const field of filled) field.basis = basisBySelector.get(field.selector);
    // One write for every filled field: one at a time cost ~0.4 s each from the worker to the database (18 Oct).
    await db.applicationEvent.createMany({
      data: filled.map((field) => ({
        applicationId,
        type: "fill",
        message: `Filled ${field.key}`,
        data: { key: field.key, source: field.source, selector: field.selector, ...(field.basis ? { basis: field.basis } : {}) } as Prisma.InputJsonValue,
      })),
    });

    const screenshot = await session.page.screenshot(SHOT);
    const screenshotKey = `screenshots/${applicationId}/${attempt}.jpg`;
    await storage.put(screenshotKey, new Uint8Array(screenshot), "image/jpeg", application.userId);
    await Promise.all([setApp(applicationId, { screenshotKey }), writeEvent(applicationId, "screenshot", screenshotKey)]);

    const page = session.page;
    const submitStep = async () => {
      // The cancel check and the submit rule check both happen after any wait, right before Submit.
      await setApp(applicationId, { status: "filling" });
      const submitCheck = await check("submit", {
        applicationId,
        isTest: profile.isTest,
        adapterSource: adapter.source,
      });
      if (!submitCheck.ok) {
        await setApp(applicationId, { status: "blocked", error: submitCheck.rule, fields: filled as Prisma.InputJsonValue });
        return null;
      }
      submitting = true;
      return adapter.submit(page, {
        requestCode: codeRequester(applicationId),
        handoff,
        person: options.person,
        announceHandoff: async (message) => {
          await writeEvent(applicationId, "ask_user", message);
          void sendPush(application.userId, { title: `${jobInfo.company}: ready to send`, body: `Press Submit in the Chrome window to send your ${jobInfo.title} application.`, url: `/applications/${applicationId}`, tag: `app-${applicationId}` });
        },
        cancelled: async () => (await db.application.findUnique({ where: { id: applicationId }, select: { status: true } }))?.status === "cancelled",
        diagnosticsTag: applicationId.slice(-6),
        markAttempted,
      });
    };
    // The per-user submit lock serialises emailed security codes (Greenhouse). A handoff run never takes it: its window can
    // wait minutes for the person, and must not hold back the same user's other applications (21 Oct: Raghav's Greenhouse
    // jobs waited behind his open Ashby windows).
    const result = handoff
      ? await submitStep()
      : await withSubmitLock(
          application.userId,
          applicationId,
          {
            onWait: async () => {
              await writeEvent(applicationId, "resolve", "Waiting for another application's security code to finish first");
            },
            shouldStop: async () => (await db.application.findUnique({ where: { id: applicationId }, select: { status: true } }))?.status === "cancelled",
          },
          submitStep,
        );
    if (!result) return;
    if (!result.confirmed) throw new MaybeSentError("Submit was pressed but the board did not confirm it. Check your email before applying again.");
    await recordAfterSubmit(applicationId, {
      status: "submitted",
      submittedAt: new Date(),
      fields: filled as Prisma.InputJsonValue,
      pendingQuestions: [],
      error: null,
    });
    confirmedSent = true;
    await writeEvent(applicationId, "submit", `Application submitted. Confirmation: ${result.evidence}`.slice(0, 300));
    const shown = livePage(page) ?? page;
    await captureConfirmation(shown, applicationId, attempt, application.userId);
    // The user sees Ashby's Success before the window closes by itself, so there is no window for them to close.
    if (handoff) await shown.waitForTimeout(HANDOFF_SUCCESS_SHOWN_MS).catch(() => undefined);
  } catch (error) {
    if (error instanceof CancelledError) throw error;
    if (error instanceof LockStopped) throw new CancelledError();
    // Recorded as sent with a confirmation: nothing that fails afterwards (a screenshot, an event) changes that.
    if (confirmedSent) {
      // The error's type only: a database error's message can echo the values it tried to write.
      console.error(`apply ${applicationId}: after the confirmed submit: ${error instanceof Error ? error.name : "error"}`);
      return;
    }
    // The person pressed Submit before the agent was ready (the fill or the wait then trips on a page that has moved on):
    // the board's own success state on the page still proves it was sent.
    if (handoff && attempted && session) {
      const live = livePage(session.page);
      const evidence = live ? await adapter.confirmation?.(live).catch(() => null) : null;
      if (evidence) {
        await recordAfterSubmit(applicationId, { status: "submitted", submittedAt: new Date(), pendingQuestions: [], error: null });
        await writeEvent(applicationId, "submit", `Application submitted. Confirmation: ${evidence} after you pressed Submit`.slice(0, 300));
        return;
      }
    }
    if (error instanceof NeedsAnswerError && !attempted) {
      // A saved answer no longer fits this form: ask again with the live options (the new answer replaces the old one).
      await setApp(applicationId, {
        status: "needs_input",
        attempt: application.attempt,
        pendingQuestions: [error.question] as Prisma.InputJsonValue,
      });
      await writeEvent(applicationId, "ask_user", `Saved answer did not fit "${error.question.label.slice(0, 60)}"`);
      void notifyNeedsInput(applicationId, "answers");
      return;
    }
    let message = error instanceof Error ? error.message : "apply failed";
    let retryable = !(error instanceof NoRetryError);
    // "Closed" is only believed when the company's own board agrees. A page that did not load looks the same.
    if (!attempted && /no longer open/i.test(message)) {
      const state = await listingState(job.source, job.company.slug, job.externalId);
      if (state === "listed") {
        // The board lists the job but its own application page says "not found": the company takes applications on its
        // own site (Cursor and PostHog do this). Retrying cannot help.
        message = "This company does not take applications on its job board page. Apply on its own careers site.";
        retryable = false;
      } else if (state === "gone") {
        await db.job.update({ where: { id: job.id }, data: { closedAt: new Date() } }).catch(() => undefined);
      }
    }
    // The board's bot check stopped the worker's own Submit on a worker with no screen, and nothing was sent (24 Oct:
    // Airbound's reCAPTCHA challenge). Never solved, and never rerun as it was: 24-25 Oct, none of 7 immediate reruns got
    // past it. A person takes it over: the run goes on the queue only a worker with a screen takes, where the form is filled
    // again in a window they can see and they press Submit (adapters/ashby.ts). The attempt is not counted.
    if (error instanceof BotCheckError && !attempted) {
      await captureFailure(session, applicationId, attempt, application.userId);
      if (!options.person) {
        // This window is closed before the person's run can open another, so only one is ever open for the form.
        await session?.close();
        await writeEvent(applicationId, "ask_user", `${PERSON_HANDOFF}. A Chrome window opens on your computer running SwipeApply: check the form, press Submit and complete Ashby's check.`);
        await setApp(applicationId, { status: "queued", attempt: application.attempt, error: null });
        await enqueueApply(applicationId, 0, { person: true });
        void sendPush(application.userId, { title: `${jobInfo.company}: Ashby wants you`, body: `Ashby asked to confirm a person is applying for ${jobInfo.title}. Open SwipeApply on your computer to press Submit.`, url: `/applications/${applicationId}`, tag: `app-${applicationId}` });
        return;
      }
      await writeEvent(applicationId, "error", message);
      await setApp(applicationId, { status: "failed", error: message });
      return;
    }
    // The user closed the handoff window before Submit, often by mistake: 21 Oct, after one job's Success the next job's
    // window came to the front where it had been, and the click meant for the finished window closed that form. It opens
    // again once; closed a second time, the user meant to skip it. Neither counts as a failed attempt.
    const reopenedBefore = handoff ? (await db.applicationEvent.count({ where: { applicationId, type: "retry", message: { startsWith: WINDOW_REOPENED } } })) > 0 : false;
    const next = decideAfterError({
      error,
      attempted,
      handoff,
      submitStage: submitting,
      windowGone: Boolean(session && !livePage(session.page)),
      reopenedBefore,
      retryable,
      attempt,
      maxAttempts: rules.max_attempts,
    });
    if (next === "reopen") {
      await writeEvent(applicationId, "retry", `${WINDOW_REOPENED}. Press Submit in it when you are ready.`);
      await setApp(applicationId, { status: "queued", attempt: application.attempt, error: null });
      await enqueueApply(applicationId, 3);
      return;
    }
    if (next === "skip") {
      const skipped = "You closed the window before pressing Submit, twice. Nothing was sent; press Retry when you want to apply.";
      await writeEvent(applicationId, "error", skipped);
      await setApp(applicationId, { status: "failed", error: skipped, attempt: application.attempt });
      return;
    }
    await captureFailure(session, applicationId, attempt, application.userId);
    if (next === "pending_verification") {
      // Submit may have gone out and nothing confirms it either way: never retried automatically (a retry could send a
      // second application). The user checks their email and says which it was (lifecycle.ts resolveVerification).
      const uncertain = error instanceof MaybeSentError ? message : `Submit was pressed, then: ${message.slice(0, 160)}. It may have been sent; check your email.`;
      await writeEvent(applicationId, "verify", uncertain);
      await recordAfterSubmit(applicationId, { status: "pending_verification", error: uncertain });
      return;
    }
    if (next === "retry") {
      await writeEvent(applicationId, "retry", message);
      await setApp(applicationId, { status: "queued", error: message });
      // A short pause first: a page that just failed to load or a form that was busy is rarely better a second later.
      await enqueueApply(applicationId, 20 * attempt);
    } else {
      await writeEvent(applicationId, "error", message);
      await setApp(applicationId, { status: "failed", error: message });
    }
  } finally {
    clearInterval(heartbeat);
    stopWatchingSubmit?.();
    // A browser opened early but never taken (the run stopped before the form) is closed too. The browser is closed
    // before the temp resume is deleted: an open page still holds the file, and on Windows the delete then fails.
    if (!session && early) session = await early.catch(() => null);
    await session?.close();
    await upload.cleanup?.().catch(() => undefined);
  }
}
