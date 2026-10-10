import { listingState } from "@/modules/jobs";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueApply } from "@/lib/queue";
import { storage } from "@/lib/storage";
import { notifyNeedsInput } from "@/lib/notify";
import { ONE_TIME_CODE_KEY } from "@/modules/answers";
import { check, loadRules, writeEvent } from "@/modules/governance";
import { NeedsAnswerError, NoRetryError, type FilledField, type PendingQuestion } from "./adapter";
import { uploadResume } from "./adapters/mock";
import { openBrowser } from "./browser";
import { boardSupported } from "./lifecycle";
import { pickAdapter } from "./pick";
import { jobQuestions } from "./questions";
import { resolveForm } from "./resolveForm";
import { formUrlAllowed } from "./urls";
import { LockStopped, withSubmitLock } from "./submitLock";

/** The user (or a queue clear) cancelled this application while it was running. */
export class CancelledError extends Error {
  constructor() {
    super("Application was cancelled");
  }
}

// Every status write goes through here, so a cancel can never be overwritten by a run that is still going.
async function setApp(applicationId: string, data: Prisma.ApplicationUpdateManyMutationInput) {
  const result = await db.application.updateMany({ where: { id: applicationId, status: { not: "cancelled" } }, data });
  if (result.count === 0) throw new CancelledError();
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

export async function runApplication(applicationId: string) {
  try {
    await execute(applicationId);
  } catch (error) {
    if (error instanceof CancelledError) return;
    throw error;
  }
}

/** What the page looked like when a run failed, so "why" is an answer and not a guess. Never blocks the failure path. */
async function captureFailure(session: Awaited<ReturnType<typeof openBrowser>> | null, applicationId: string, attempt: number, userId: string) {
  const page = session?.page;
  if (!page || page.isClosed()) return;
  try {
    const shot = await page.screenshot({ type: "png", fullPage: true, timeout: 10000 });
    const key = `screenshots/${applicationId}/fail-${attempt}.png`;
    await storage.put(key, new Uint8Array(shot), "image/png", userId);
    await writeEvent(applicationId, "screenshot", key);
    // Only lines that look like messages from the site, never form values.
    const lines = (await page.locator("body").innerText({ timeout: 5000 })).split(String.fromCharCode(10)).map((line) => line.trim());
    const notes = lines.filter((line) => line.length < 160 && /error|required|invalid|spam|captcha|try again|something went wrong|not found|unable/i.test(line)).slice(0, 6);
    if (notes.length > 0) await writeEvent(applicationId, "diagnostic", `Page said: ${notes.join(" | ")}`.slice(0, 400));
  } catch {
    /* the page is gone; the error message already says what happened */
  }
}

async function execute(applicationId: string) {
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
  // It is asked again with the form's own choices (up to MAX_ASKS times in all); only then does the run give up, so a
  // wording mismatch costs one more tap instead of the application (6 runs failed this way in the week to 10 Oct).
  const MAX_ASKS = 3;
  const repeatedQuestion = async (pending: PendingQuestion[]) => {
    const asks = await db.applicationEvent.findMany({ where: { applicationId, type: "ask_user" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (asks.length < MAX_ASKS) return undefined;
    return pending.find((question) => answers.some((row) => row.key === question.key && row.updatedAt >= asks[0].createdAt));
  };
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
          const message = `After ${MAX_ASKS} tries, your answer for "${repeatedEarly.label.slice(0, 80)}" still does not match this form's options`;
          await writeEvent(applicationId, "error", message);
          await setApp(applicationId, { status: "failed", error: message, attempt: application.attempt });
          return;
        }
        await setApp(applicationId, { status: "needs_input", attempt: application.attempt, pendingQuestions: before.missing as Prisma.InputJsonValue });
        await writeEvent(applicationId, "ask_user", `Need ${before.missing.length} answers before opening the form`);
        void notifyNeedsInput(applicationId, "answers");
        return;
      }
      await writeEvent(applicationId, "resolve", "Every question on the form can be answered; opening it");
    }
    session = await openBrowser(formUrl, application.userId);
    const fields = await adapter.inspect(session.page);
    await writeEvent(applicationId, "inspect", `Found ${fields.length} fields`);
    const { resolved } = await resolveForm({ userId: application.userId, source: adapter.source, fields, profile, answers, job: jobInfo, draftEssays: true, log: resolveLog });
    await writeEvent(applicationId, "resolve", `Resolved ${resolved.values.length}, pending ${resolved.pending.length}`);
    const repeated = await repeatedQuestion(resolved.pending);
    if (repeated) {
      const message = `After ${MAX_ASKS} tries, your answer for "${repeated.label.slice(0, 80)}" still does not match this form's options`;
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
      const stored = await storage.get(profile.resumeKey);
      if (!stored) throw new Error("Resume file is missing");
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
    for (const field of filled) {
      await writeEvent(applicationId, "fill", `Filled ${field.key}`, undefined, {
        key: field.key,
        source: field.source,
        selector: field.selector,
        ...(field.basis ? { basis: field.basis } : {}),
      });
    }

    const screenshot = await session.page.screenshot({ type: "png" });
    const screenshotKey = `screenshots/${applicationId}/${attempt}.png`;
    await storage.put(screenshotKey, new Uint8Array(screenshot), "image/png", application.userId);
    await setApp(applicationId, { screenshotKey });
    await writeEvent(applicationId, "screenshot", screenshotKey);

    const page = session.page;
    const result = await withSubmitLock(
      application.userId,
      applicationId,
      {
        onWait: async () => {
          await writeEvent(applicationId, "resolve", "Waiting for another application's security code to finish first");
        },
        shouldStop: async () => (await db.application.findUnique({ where: { id: applicationId }, select: { status: true } }))?.status === "cancelled",
      },
      async () => {
        // The cancel check and the submit rule check both happen after the wait, right before clicking Submit.
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
        return adapter.submit(page, { requestCode: codeRequester(applicationId) });
      },
    );
    if (!result) return;
    if (!result.confirmed) throw new Error("Submit was not confirmed");
    await setApp(applicationId, {
      status: "submitted",
      submittedAt: new Date(),
      fields: filled as Prisma.InputJsonValue,
      pendingQuestions: [],
      error: null,
    });
    await writeEvent(applicationId, "submit", `Application submitted. Confirmation: ${result.evidence}`.slice(0, 300));
  } catch (error) {
    if (error instanceof CancelledError) throw error;
    if (error instanceof LockStopped) throw new CancelledError();
    if (error instanceof NeedsAnswerError) {
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
    await captureFailure(session, applicationId, attempt, application.userId);
    let message = error instanceof Error ? error.message : "apply failed";
    let retryable = !(error instanceof NoRetryError);
    // "Closed" is only believed when the company's own board agrees. A page that did not load looks the same.
    if (/no longer open/i.test(message)) {
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
    if (attempt < rules.max_attempts && retryable) {
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
    await upload.cleanup?.();
    await session?.close();
  }
}
