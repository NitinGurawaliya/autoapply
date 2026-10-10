import { db } from "@/lib/db";
import { sendPush } from "@/lib/push";

// When an application needs the user: a browser push (lib/push.ts) and an optional email, off unless NOTIFY_WEBHOOK_URL is set; the webhook receives
// {to, subject, text} and sends the email (Resend, SES, Zapier, anything that takes a POST).
// Message text carries the company, role and what is needed, never answers, codes or personal details beyond the address.

export type NeedsKind = "answers" | "code";

export function notifyConfigured() {
  return Boolean(process.env.NOTIFY_WEBHOOK_URL);
}

export function buildMessage(input: { company: string; title: string; kind: NeedsKind; link: string }) {
  const what = input.kind === "code" ? "enter the security code Greenhouse emailed you" : "answer a question";
  return {
    subject: input.kind === "code" ? `${input.company}: enter the security code` : `${input.company} needs an answer`,
    text: `Your application for ${input.title} at ${input.company} is paused until you ${what}.\n\nOpen it: ${input.link}`,
  };
}

/** Never throws and never blocks the run: a failed email must not fail an application. */
export async function notifyNeedsInput(applicationId: string, kind: NeedsKind) {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  try {
    const application = await db.application.findUnique({ where: { id: applicationId }, select: { userId: true, jobId: true } });
    if (!application) return false;
    const [user, job] = await Promise.all([
      db.user.findUnique({ where: { id: application.userId }, select: { email: true } }),
      db.job.findUnique({ where: { id: application.jobId }, select: { title: true, company: { select: { name: true } } } }),
    ]);
    if (!user || !job) return false;
    const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const message = buildMessage({ company: job.company.name, title: job.title, kind, link: `${base}/applications/${applicationId}` });
    // Browser push to every browser the user turned notifications on in (lib/push.ts): the run waits for them.
    await sendPush(application.userId, {
      title: message.subject,
      body: kind === "code" ? `Enter the code to finish your ${job.title} application.` : `Answer to continue your ${job.title} application.`,
      url: `/applications/${applicationId}`,
      tag: `app-${applicationId}`,
    });
    if (!url) return false;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.NOTIFY_WEBHOOK_SECRET ? { Authorization: `Bearer ${process.env.NOTIFY_WEBHOOK_SECRET}` } : {}) },
      body: JSON.stringify({ to: user.email, ...message }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
