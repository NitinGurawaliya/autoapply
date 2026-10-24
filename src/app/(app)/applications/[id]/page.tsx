import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ApplicationActions } from "@/components/application-actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { buttonVariants } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Icon } from "@/components/ui/icons";
import { CompanyMark, StatusPill } from "@/components/ui/marks";
import { EmptyState, TrustPanel } from "@/components/patterns/content";
import { FailureCard, FieldList, ScreenshotFrame, Timeline, type StoryStep } from "@/components/patterns/detail";
import { DeckEmptyArt } from "@/components/patterns/drawings";
import { AgentStatus } from "@/components/patterns/agent-status";
import { BackTopBar } from "@/components/patterns/top-bar";
import { isAdmin } from "@/lib/admin";
import { boardLabel } from "@/lib/board-label";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { EVENT_LABEL } from "@/lib/event-labels";
import { explainOutcome } from "@/lib/explain";
import { groupFields } from "@/lib/field-groups";
import { applicationVersion, STAGES, statusMeta } from "@/lib/status-meta";
import { buildSteps } from "@/lib/steps";

const fieldsSchema = z.array(
  z.object({ key: z.string(), label: z.string(), value: z.string(), source: z.string(), selector: z.string().optional(), basis: z.string().optional() }),
);

const RUNNING = ["queued", "inspecting", "filling", "needs_input"];
const STOPPED = ["failed", "blocked", "cancelled"];
const ZONE = "Asia/Kolkata";

function clock(date: Date, seconds = false) {
  return date.toLocaleTimeString("en-IN", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false });
}

/** "today, 10:42", "yesterday, 9:15", "8 Oct, 18:02" in India time. */
function when(date: Date) {
  const day = (value: Date) => value.toLocaleDateString("en-CA", { timeZone: ZONE });
  const now = new Date();
  const time = clock(date);
  if (day(date) === day(now)) return `today, ${time}`;
  if (day(date) === day(new Date(now.getTime() - 86_400_000))) return `yesterday, ${time}`;
  return `${date.toLocaleDateString("en-IN", { timeZone: ZONE, day: "numeric", month: "short" })}, ${time}`;
}

// Which audit event marks each step of buildSteps(), for the time beside it in the story.
const STEP_EVENT: Record<string, (event: { type: string; message: string }) => boolean> = {
  read: (event) => event.type === "inspect",
  prepared: (event) => event.type === "resolve" && !/security code/i.test(event.message),
  asked: (event) => event.type === "ask_user" && !/security code/i.test(event.message),
  filled: (event) => event.type === "fill",
  code: (event) => event.type === "resolve" && /security code received/i.test(event.message),
  submitted: (event) => event.type === "submit",
};

/** One line on where the answers came from: "Every answer came from your resume or from you. 1 note was written by your agent, marked below." */
function trustText(sources: string[]) {
  const drafts = sources.filter((source) => source === "ai_draft").length;
  const base = sources.some((source) => source !== "ai_draft") ? "Every answer came from your resume or from you." : "";
  const draftText = drafts === 0 ? "" : ` ${drafts} ${drafts === 1 ? "note was" : "notes were"} written by your agent, marked below.`;
  return `${base}${draftText}`.trim();
}

export default async function ApplicationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ debug?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const { id } = await params;
  // The raw audit log is for the operator only (ADMIN_EMAILS) and only on ?debug=1 (24 Oct, owner).
  const debug = isAdmin(user.email) && (await searchParams).debug === "1";
  const application = await db.application.findFirst({
    where: { id, userId: user.id },
    include: { events: { orderBy: { createdAt: "asc" } } },
  });
  const job = application
    ? await db.job.findUnique({
        where: { id: application.jobId },
        select: { title: true, location: true, applyUrl: true, source: true, company: { select: { name: true, logoUrl: true } } },
      })
    : null;

  if (!application) {
    return (
      <>
        <BackTopBar href="/applications" label="Application" backLabel="Back to applications" />
        <EmptyState
          art={<DeckEmptyArt />}
          title="Application not found"
          text="It may have been removed, or it belongs to another account."
          actions={
            <Link href="/applications" className={buttonVariants({ variant: "primary", size: "xl", className: "w-full" })}>
              Back to applications
            </Link>
          }
        />
      </>
    );
  }

  const parsed = fieldsSchema.safeParse(application.fields ?? []);
  const fields = parsed.success ? parsed.data : [];
  const groups = groupFields(fields);
  const asksForCode = Array.isArray(application.pendingQuestions) && application.pendingQuestions.some((q) => (q as { key?: string })?.key === "security_code");
  const outcome = explainOutcome(application.status, application.error, application.status === "needs_input" ? (asksForCode ? "code" : "answers") : null);
  const company = job?.company.name ?? "Unknown company";
  const role = job?.title ?? "Application";
  const sent = application.status === "submitted";
  const stopped = STOPPED.includes(application.status);

  // The story: the swipe, then each step that has happened (or is happening) with the time of its event.
  // Like the design, steps still to come are not listed.
  const answers = { yours: fields.filter((field) => field.source !== "ai_draft").length, drafted: fields.filter((field) => field.source === "ai_draft").length };
  const story: StoryStep[] = [
    { key: "swiped", time: clock(application.createdAt), title: "You picked this job", state: "done" as const },
    ...buildSteps(application.events, application.status, answers).map((step): StoryStep => {
      const event = application.events.find((item) => STEP_EVENT[step.key]?.(item));
      const sub = step.state === "current" ? "working on it now" : step.state === "stopped" ? "stopped here" : (step.note ?? null);
      const state: StoryStep["state"] = step.key === "submitted" && step.state === "done" ? "end" : step.state;
      return { key: step.key, time: event && step.state !== "todo" ? clock(event.createdAt) : "", title: step.label, sub, state };
    }),
  ].filter((step) => step.state !== "todo");

  const counts = ["resume", "user", "matched", "derived", "default", "ai_draft"]
    .map((source) => ({ source, count: fields.filter((field) => field.source === source).length }))
    .filter((item) => item.count > 0);
  const shot = application.events.find((event) => event.type === "screenshot");
  // Where a failed run stopped: the page as the agent last saw it (runner.ts captureFailure), newest attempt.
  const failShot = stopped ? application.events.findLast((event) => event.type === "screenshot" && /\/fail-\d+\.(png|jpg)$/.test(event.message ?? "")) : undefined;
  const board = boardLabel(job?.source);
  const working = ["queued", "inspecting", "filling"].includes(application.status);
  // The job board's own confirmation, taken after Submit (runner.ts captureConfirmation).
  const sentShot = sent ? application.events.findLast((event) => event.type === "screenshot" && /\/sent-\d+\.(png|jpg)$/.test(event.message ?? "")) : undefined;
  const address = (() => {
    try {
      return job?.applyUrl ? new URL(job.applyUrl).host + new URL(job.applyUrl).pathname : company;
    } catch {
      return company;
    }
  })();

  return (
    <>
      <BackTopBar href="/applications" label="Application" backLabel="Back to applications" />
      {/* Checks a small version endpoint and re-renders only on a change: every 3 s while the agent works, every 10 s
          while it waits for the user (that changes only when they answer). */}
      <AutoRefresh
        active={RUNNING.includes(application.status)}
        everyMs={application.status === "needs_input" ? 10_000 : 3000}
        versionUrl={`/api/applications/${application.id}?only=version`}
        version={applicationVersion(application.status, application.events.length)}
      />
      <div className="flex flex-col px-5 pb-10">
        <header className="flex flex-col gap-1.5 pt-3.5">
          <CompanyMark name={company} logoUrl={job?.company.logoUrl} size={56} />
          <h1 className="m-0 mt-2.5 type-display-md">{role}</h1>
          <span className="text-[15px] text-muted-foreground">
            {company}
            {job?.location ? ` · ${job.location}` : ""}
            {board ? ` · via ${board}` : ""}
          </span>
          <span className="mt-2 flex">
            <StatusPill kind={stopped ? "stop" : "ok"}>
              {sent && application.submittedAt ? `Sent ${when(application.submittedAt)}` : statusMeta(application.status).label}
            </StatusPill>
          </span>
        </header>

        {working ? (
          <section aria-label="Where this stands" className="mt-5 flex flex-col gap-3 rounded-panel bg-inverse p-4 text-inverse-foreground">
            <AgentStatus text={STAGES[statusMeta(application.status).stage ?? 0]} detail={`Your agent is applying to ${company}`} />
            <ApplicationActions id={application.id} status={application.status} company={company} look="panel" />
          </section>
        ) : !sent ? (
          <FailureCard
            eyebrow={stopped ? "What happened" : ["needs_input", "pending_verification"].includes(application.status) ? "What it needs" : "Where it is"}
            headline={outcome.headline}
            text={outcome.next}
            actions={
              [...RUNNING, "pending_verification", "failed", "cancelled"].includes(application.status) ? (
                <ApplicationActions id={application.id} status={application.status} company={company} look="panel" />
              ) : undefined
            }
            note={application.status === "blocked" ? "Nothing was sent. Your agent held it back before opening the form." : undefined}
          />
        ) : null}

        {fields.length > 0 ? <TrustPanel className="mt-5" text={trustText(fields.map((field) => field.source))} counts={counts} /> : null}

        <section aria-label="Progress" className="mt-8">
          <Eyebrow as="h2" className="mb-3.5">
            The story
          </Eyebrow>
          <Timeline steps={story} />
        </section>

        <section aria-label="What was filled in" className="mt-6">
          <Eyebrow as="h2" className="mb-1.5">
            {sent ? "Everything your agent filled in" : stopped ? "What your agent filled in before it stopped" : "What your agent has filled in so far"}
            {fields.length > 0 ? ` · ${fields.length} fields` : ""}
          </Eyebrow>
          {fields.length === 0 ? (
            <p className="m-0 py-3 text-sm text-muted-foreground">
              {sent ? "No field list was saved for this application." : "The list appears here once the form has been filled in and sent."}
            </p>
          ) : (
            <FieldList groups={groups} />
          )}
        </section>

        {application.screenshotKey ? (
          <section aria-label="Screenshot" className="mt-8 flex flex-col gap-3">
            <Eyebrow as="h2">{sent ? "The form just before your agent sent it" : "The form as your agent filled it"}</Eyebrow>
            <ScreenshotFrame src={`/api/files/${application.screenshotKey}`} alt="The filled application form" address={address} />
            {shot ? (
              <span className="text-[13px] text-muted-foreground">
                Taken at {clock(shot.createdAt, true)}
                {sent ? ", right before your agent pressed Submit." : "."}
              </span>
            ) : null}
            <a
              href={`/api/files/${application.screenshotKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "line", size: "md", className: "w-full rounded-field" })}
            >
              View full size
            </a>
          </section>
        ) : null}

        {sentShot?.message ? (
          <section aria-label="Confirmation" className="mt-8 flex flex-col gap-3">
            <Eyebrow as="h2">What the job board showed after Submit</Eyebrow>
            <ScreenshotFrame src={`/api/files/${sentShot.message}`} alt="The job board's confirmation page" address={address} />
            <span className="text-[13px] text-muted-foreground">Taken at {clock(sentShot.createdAt, true)}, right after it confirmed.</span>
            <a
              href={`/api/files/${sentShot.message}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "line", size: "md", className: "w-full rounded-field" })}
            >
              View full size
            </a>
          </section>
        ) : null}

        {failShot?.message ? (
          <section aria-label="Where it stopped" className="mt-8 flex flex-col gap-3">
            <Eyebrow as="h2">Where it stopped</Eyebrow>
            <ScreenshotFrame src={`/api/files/${failShot.message}`} alt="The page when the application stopped" address={address} />
            <span className="text-[13px] text-muted-foreground">What your agent saw at {clock(failShot.createdAt, true)}.</span>
          </section>
        ) : null}

        {job?.applyUrl ? (
          <a
            href={job.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 flex h-12 items-center gap-2 self-start text-[15px] font-semibold text-foreground underline underline-offset-3"
          >
            Open the original posting
            <Icon name="external" size={16} />
          </a>
        ) : null}

        {debug ? (
        <details className="group mt-4 rounded-[18px] border-[1.5px] border-line bg-surface">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-[15px] font-semibold marker:hidden">
            Technical details
            <span className="text-[13px] font-normal text-muted-foreground group-open:hidden">for debugging</span>
          </summary>
          <div className="flex flex-col gap-3 px-4 pb-4">
            {application.error ? <p className="m-0 text-[13px] break-words text-muted-foreground">Raw error: {application.error}</p> : null}
            <ol className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
              {application.events
                .filter((event) => event.type !== "fill")
                .map((event) => (
                  <li key={event.id} className="flex gap-2">
                    <span className="w-16 shrink-0 text-muted-foreground tabular-nums">{clock(event.createdAt, true)}</span>
                    <span className="w-24 shrink-0 font-semibold">{EVENT_LABEL[event.type] ?? event.type}</span>
                    <span className="break-words text-muted-foreground">
                      {event.rule ? `${event.rule}: ` : ""}
                      {event.message}
                    </span>
                  </li>
                ))}
            </ol>
          </div>
        </details>
        ) : null}
      </div>
    </>
  );
}
