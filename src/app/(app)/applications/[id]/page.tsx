import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, CircleDot, ExternalLink, Minus, X } from "lucide-react";
import { z } from "zod";
import { ApplicationActions } from "@/components/application-actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { CompanyAvatar } from "@/components/company-avatar";
import { SourceBadge, StatusBadge } from "@/components/status-badge";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { EVENT_LABEL } from "@/lib/event-labels";
import { explainOutcome, type Tone } from "@/lib/explain";
import { groupFields } from "@/lib/field-groups";
import { buildSteps, type StepState } from "@/lib/steps";

const fieldsSchema = z.array(
  z.object({ key: z.string(), label: z.string(), value: z.string(), source: z.string(), selector: z.string().optional() }),
);

const RUNNING = ["queued", "inspecting", "filling", "needs_input"];

const CALLOUT: Record<Tone, string> = {
  success: "border-success/30 bg-success-soft text-success",
  info: "border-info/30 bg-info-soft text-info",
  warning: "border-warning/30 bg-warning-soft text-warning",
  danger: "border-danger/30 bg-danger-soft text-danger",
  neutral: "border-border bg-muted text-muted-foreground",
};

const STEP_DOT: Record<StepState, string> = {
  done: "bg-success text-success-soft",
  current: "bg-primary text-primary-foreground ring-4 ring-accent animate-pulse",
  stopped: "bg-danger text-danger-soft",
  todo: "border border-border bg-card text-muted-foreground",
};

function StepIcon({ state }: { state: StepState }) {
  const className = "size-3.5";
  if (state === "done") return <Check className={className} aria-hidden />;
  if (state === "stopped") return <X className={className} aria-hidden />;
  if (state === "current") return <CircleDot className={className} aria-hidden />;
  return <Minus className={className} aria-hidden />;
}

function when(date: Date) {
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
}

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const { id } = await params;
  const application = await db.application.findFirst({
    where: { id, userId: user.id },
    include: { events: { orderBy: { createdAt: "asc" } } },
  });
  const job = application
    ? await db.job.findUnique({
        where: { id: application.jobId },
        select: { title: true, location: true, applyUrl: true, company: { select: { name: true } } },
      })
    : null;

  if (!application) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-card">
        <h1 className="text-base font-semibold">Application not found</h1>
        <p className="text-sm text-muted-foreground">It may have been removed, or it belongs to another account.</p>
        <Link href="/applications" className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Back to applications
        </Link>
      </div>
    );
  }

  const parsed = fieldsSchema.safeParse(application.fields ?? []);
  const fields = parsed.success ? parsed.data : [];
  const groups = groupFields(fields);
  const asksForCode = Array.isArray(application.pendingQuestions) && application.pendingQuestions.some((q) => (q as { key?: string })?.key === "security_code");
  const outcome = explainOutcome(application.status, application.error, application.status === "needs_input" ? (asksForCode ? "code" : "answers") : null);
  const steps = buildSteps(application.events, application.status);
  const company = job?.company.name ?? "Unknown company";
  const showCallout = application.status !== "submitted";

  return (
    <>
      <AutoRefresh active={RUNNING.includes(application.status)} />
      <div className="flex flex-col gap-3">
        <Link href="/applications" className="text-xs text-muted-foreground underline underline-offset-4">
          All applications
        </Link>
        <div className="flex items-start gap-3">
          <CompanyAvatar name={company} />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-snug">{job?.title ?? "Application"}</h1>
            <p className="truncate text-sm text-muted-foreground">{company}</p>
          </div>
          <StatusBadge status={application.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          {job?.location ? `${job.location} · ` : ""}
          {application.submittedAt ? `Submitted ${when(application.submittedAt)}` : `Started ${when(application.createdAt)}`}
        </p>
        {job?.applyUrl ? (
          <a
            href={job.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            View job posting
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </div>

      {showCallout ? (
        <section className={`flex flex-col gap-2 rounded-2xl border p-4 ${CALLOUT[outcome.tone]}`} aria-label="Where this stands">
          <p className="text-sm font-semibold">{outcome.headline}</p>
          {outcome.next ? <p className="text-sm text-foreground/80">{outcome.next}</p> : null}
          <div className="pt-1">
            <ApplicationActions id={application.id} status={application.status} company={company} />
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3" aria-label="Progress">
        <h2 className="text-sm font-semibold">What happened</h2>
        <ol className="flex flex-col">
          {steps.map((step, index) => (
            <li key={step.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={`grid size-6 shrink-0 place-items-center rounded-full ${STEP_DOT[step.state]}`}>
                  <StepIcon state={step.state} />
                </span>
                {index < steps.length - 1 ? <span className={`my-1 w-px flex-1 ${step.state === "done" ? "bg-success/40" : "bg-border"}`} /> : null}
              </div>
              <div className="pb-4">
                <p className={`text-sm ${step.state === "todo" ? "text-muted-foreground" : "font-medium"}`}>
                  {step.label}
                  {step.state === "current" ? <span className="ml-2 text-xs font-normal text-primary">in progress</span> : null}
                  {step.state === "stopped" ? <span className="ml-2 text-xs font-normal text-danger">stopped here</span> : null}
                </p>
                {step.note ? <p className="break-words text-xs text-muted-foreground">{step.note}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3" aria-label="What was filled in">
        <h2 className="text-sm font-semibold">
          What was filled in
          {fields.length > 0 ? <span className="ml-2 text-xs font-normal text-muted-foreground">{fields.length} fields</span> : null}
        </h2>
        {fields.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-3 py-4 text-sm text-muted-foreground">
            {application.status === "submitted"
              ? "No field list was saved for this application."
              : "The list appears here once the form has been filled in and sent."}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.name} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.name}</h3>
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-card">
                {group.fields.map((field, index) => (
                  <li key={`${field.key}-${index}`} className="flex flex-col gap-1 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs text-muted-foreground">{field.label}</span>
                      <SourceBadge source={field.source} />
                    </div>
                    <span className="break-words text-sm">{field.value || "—"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {application.screenshotKey ? (
        <details className="group rounded-xl border border-border bg-card shadow-card">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold marker:hidden">
            Form before submitting
            <span className="ml-2 text-xs font-normal text-muted-foreground group-open:hidden">tap to show</span>
          </summary>
          <div className="px-4 pb-4">
            <a href={`/api/files/${application.screenshotKey}`} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/files/${application.screenshotKey}`}
                alt="The filled application form"
                className="w-full rounded-lg border border-border"
                loading="lazy"
              />
            </a>
          </div>
        </details>
      ) : null}

      <details className="group rounded-xl border border-border bg-card">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold marker:hidden">
          Technical details
          <span className="ml-2 text-xs font-normal text-muted-foreground group-open:hidden">for debugging</span>
        </summary>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {application.error ? <p className="break-words text-xs text-muted-foreground">Raw error: {application.error}</p> : null}
          <ol className="flex flex-col gap-1 text-xs">
            {application.events
              .filter((event) => event.type !== "fill")
              .map((event) => (
                <li key={event.id} className="flex gap-2">
                  <span className="w-16 shrink-0 text-muted-foreground">
                    {event.createdAt.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span className="w-24 shrink-0 font-medium">{EVENT_LABEL[event.type] ?? event.type}</span>
                  <span className="break-words text-muted-foreground">
                    {event.rule ? `${event.rule}: ` : ""}
                    {event.message}
                  </span>
                </li>
              ))}
          </ol>
        </div>
      </details>
    </>
  );
}
