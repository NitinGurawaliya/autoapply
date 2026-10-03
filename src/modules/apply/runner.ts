import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueApply } from "@/lib/queue";
import { storage } from "@/lib/storage";
import { ONE_TIME_CODE_KEY } from "@/modules/answers";
import { check, loadRules, writeEvent } from "@/modules/governance";
import { NoRetryError, type FilledField } from "./adapter";
import { uploadResume } from "./adapters/mock";
import { openBrowser } from "./browser";
import { mapFields } from "./fieldMapper";
import { pickAdapter } from "./pick";
import { resolveValues } from "./valueResolver";

async function block(applicationId: string, rule: string, message: string) {
  await writeEvent(applicationId, "block", message, rule);
  await db.application.update({
    where: { id: applicationId },
    data: { status: "blocked", error: rule },
  });
}

export const CODE_WAIT_MS = 10 * 60 * 1000;

// The only time the runner holds a browser while waiting on the user: an emailed code is tied to this browser session.
export function codeRequester(applicationId: string) {
  return async (prompt: string) => {
    await db.application.update({
      where: { id: applicationId },
      data: {
        status: "needs_input",
        verificationCode: null,
        pendingQuestions: [{ key: ONE_TIME_CODE_KEY, label: prompt, type: "text", required: true }],
      },
    });
    await writeEvent(applicationId, "ask_user", "Waiting for the emailed security code");
    const deadline = Date.now() + CODE_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const row = await db.application.findUnique({ where: { id: applicationId }, select: { verificationCode: true } });
      if (row?.verificationCode) {
        await db.application.update({
          where: { id: applicationId },
          data: { verificationCode: null, status: "filling", pendingQuestions: [] },
        });
        await writeEvent(applicationId, "resolve", "Security code received");
        return row.verificationCode;
      }
    }
    await db.application.update({ where: { id: applicationId }, data: { pendingQuestions: [] } });
    return null;
  };
}

export async function runApplication(applicationId: string) {
  const application = await db.application.findUnique({ where: { id: applicationId } });
  if (!application) throw new Error("Application not found");
  if (application.status === "submitted" || application.status === "blocked") return;

  const [job, profile, answers] = await Promise.all([
    db.job.findUnique({ where: { id: application.jobId }, include: { company: { select: { slug: true } } } }),
    db.profile.findUnique({ where: { userId: application.userId } }),
    db.answer.findMany({ where: { userId: application.userId } }),
  ]);
  if (!job || !profile) {
    await block(applicationId, "profile_required", "Profile or job is missing");
    return;
  }

  const rules = loadRules();
  const attempt = application.attempt + 1;
  await db.application.update({
    where: { id: applicationId },
    data: { attempt, status: "inspecting" },
  });

  const adapter = pickAdapter(job.applyUrl, job.source);
  const formUrl = adapter.formUrl?.({ applyUrl: job.applyUrl, externalId: job.externalId, companySlug: job.company.slug }) ?? job.applyUrl;
  const started = await check("start", { applicationId, profileExists: true, isTest: profile.isTest, adapterSource: adapter.source });
  if (!started.ok) {
    await db.application.update({
      where: { id: applicationId },
      data: { status: "blocked", error: started.rule },
    });
    return;
  }
  if (profile.isTest && adapter.source !== "mock") {
    await block(applicationId, "test_profile_mock_only", "Test profiles can only apply on the mock form");
    return;
  }

  let session: Awaited<ReturnType<typeof openBrowser>> | null = null;
  let cleanupUpload: (() => Promise<void>) | null = null;
  try {
    session = await openBrowser(formUrl);
    const fields = await adapter.inspect(session.page);
    await writeEvent(applicationId, "inspect", `Found ${fields.length} fields`);
    const mapped = await mapFields(adapter.source, fields);
    const resolved = resolveValues(mapped, profile, answers);
    await writeEvent(applicationId, "resolve", `Resolved ${resolved.values.length}, pending ${resolved.pending.length}`);
    // An already-answered question coming back means the saved answer no longer fits the form; asking again would loop.
    const repeated = resolved.pending.find((question) => answers.some((row) => row.key === question.key));
    if (repeated) {
      const message = `Your saved answer for "${repeated.label.slice(0, 80)}" does not match this form's options`;
      await writeEvent(applicationId, "error", message);
      await db.application.update({
        where: { id: applicationId },
        data: { status: "failed", error: message, attempt: application.attempt },
      });
      return;
    }
    if (resolved.pending.length > 0) {
      await db.application.update({
        where: { id: applicationId },
        data: {
          status: "needs_input",
          // Pausing for the user is not a failed attempt.
          attempt: application.attempt,
          pendingQuestions: resolved.pending as Prisma.InputJsonValue,
        },
      });
      await writeEvent(applicationId, "ask_user", `Need ${resolved.pending.length} answers`);
      return;
    }

    await db.application.update({ where: { id: applicationId }, data: { status: "filling" } });
    const textValues = resolved.values.filter((value) => value.type !== "file");
    const filled: FilledField[] = await adapter.fill(session.page, textValues);
    const resume = resolved.values.find((value) => value.type === "file");
    if (resume) {
      const stored = await storage.get(profile.resumeKey);
      if (!stored) throw new Error("Resume file is missing");
      cleanupUpload = adapter.uploadFile
        ? await adapter.uploadFile(session.page, resume, stored.bytes)
        : await uploadResume(session.page, resume, stored.bytes);
      filled.push({
        key: resume.key,
        label: resume.label,
        value: resume.fileName ?? "resume.pdf",
        source: resume.source,
        selector: resume.selector,
      });
    }
    for (const field of filled) {
      await writeEvent(applicationId, "fill", `Filled ${field.key}`, undefined, {
        key: field.key,
        source: field.source,
        selector: field.selector,
      });
    }

    const screenshot = await session.page.screenshot({ type: "png" });
    const screenshotKey = `screenshots/${applicationId}/${attempt}.png`;
    await storage.put(screenshotKey, new Uint8Array(screenshot), "image/png", application.userId);
    await db.application.update({ where: { id: applicationId }, data: { screenshotKey } });
    await writeEvent(applicationId, "screenshot", screenshotKey);

    const submitCheck = await check("submit", {
      applicationId,
      isTest: profile.isTest,
      adapterSource: adapter.source,
    });
    if (!submitCheck.ok) {
      await db.application.update({
        where: { id: applicationId },
        data: { status: "blocked", error: submitCheck.rule, fields: filled as Prisma.InputJsonValue },
      });
      return;
    }

    const result = await adapter.submit(session.page, { requestCode: codeRequester(applicationId) });
    if (!result.confirmed) throw new Error("Submit was not confirmed");
    await db.application.update({
      where: { id: applicationId },
      data: {
        status: "submitted",
        submittedAt: new Date(),
        fields: filled as Prisma.InputJsonValue,
        pendingQuestions: [],
        error: null,
      },
    });
    await writeEvent(applicationId, "submit", "Application submitted");
  } catch (error) {
    const message = error instanceof Error ? error.message : "apply failed";
    if (attempt < rules.max_attempts && !(error instanceof NoRetryError)) {
      await writeEvent(applicationId, "retry", message);
      await db.application.update({ where: { id: applicationId }, data: { status: "queued", error: message } });
      await enqueueApply(applicationId);
    } else {
      await writeEvent(applicationId, "error", message);
      await db.application.update({
        where: { id: applicationId },
        data: { status: "failed", error: message },
      });
    }
  } finally {
    await cleanupUpload?.();
    await session?.close();
  }
}
