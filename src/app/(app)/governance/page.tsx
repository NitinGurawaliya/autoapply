import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { EVENT_LABEL } from "@/lib/event-labels";
import { explainOutcome } from "@/lib/explain";
import { describeRules } from "@/lib/rule-text";
import { governanceOverview } from "@/modules/governance";

export const dynamic = "force-dynamic";

function when(date: Date) {
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-card p-3 shadow-card" data-stat={label}>
      <span className="text-xl font-semibold leading-none">{value}</span>
      <span className="text-xs font-medium">{label}</span>
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

export default async function GovernancePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const overview = await governanceOverview(user.id);
  const rules = describeRules(overview.rules);
  const { counters } = overview;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Governance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The rules the agent has to obey, enforced in code, not just in instructions. Every decision it makes is written down below.
        </p>
      </div>

      <section className="flex flex-col gap-2" aria-label="Today">
        <h2 className="text-sm font-semibold">Today</h2>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Started" value={`${counters.started} of ${counters.cap}`} hint="Applications begun, against the daily limit" />
          <Stat label="Submitted" value={String(counters.submitted)} hint="Sent to a company" />
          <Stat label="Blocked" value={String(counters.blocked)} hint="Stopped by a rule" />
          <Stat label="Questions asked" value={String(counters.asked)} hint="Times it paused to ask you" />
          <Stat label="Rule checks" value={String(counters.checks)} hint="Every one is logged" />
        </div>
        <p className="text-[11px] text-muted-foreground">Days run on UTC.</p>
      </section>

      <section className="flex flex-col gap-2" aria-label="Rules">
        <h2 className="text-sm font-semibold">Rules in force</h2>
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-card">
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-col gap-1 px-3 py-3" data-rule={rule.id}>
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-medium">{rule.title}</span>
                <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">{rule.value}</span>
              </div>
              <span className="text-xs text-muted-foreground">{rule.meaning}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2" aria-label="What was blocked">
        <h2 className="text-sm font-semibold">What was blocked, and why</h2>
        {overview.blocks.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-3 py-4 text-sm text-muted-foreground">Nothing has been blocked. When a rule stops an application, it shows up here with the reason.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-card">
            {overview.blocks.map((block) => {
              const why = explainOutcome("blocked", block.rule);
              return (
                <li key={block.id} className="px-3 py-3" data-block-rule={block.rule ?? ""}>
                  <Link href={`/applications/${block.applicationId}`} className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {block.title} <span className="font-normal text-muted-foreground">at {block.company}</span>
                    </span>
                    <span className="text-xs">
                      <span className="font-semibold text-danger">{why.headline}.</span> <span className="text-muted-foreground">{block.message}</span>
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Rule: {block.rule ?? "unknown"} · {when(block.createdAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label="Latest decisions">
        <h2 className="text-sm font-semibold">Latest decisions</h2>
        {overview.events.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-3 py-4 text-sm text-muted-foreground">Nothing yet. Swipe right on a job and each step is recorded here.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-card">
            {overview.events.map((event) => (
              <li key={event.id} className="flex flex-col gap-0.5 px-3 py-2.5 text-xs" data-event-type={event.type}>
                <div className="flex items-start justify-between gap-3">
                  <span className={event.type === "block" || event.type === "error" ? "font-semibold text-danger" : "font-medium"}>{EVENT_LABEL[event.type] ?? event.type}</span>
                  <span className="shrink-0 text-muted-foreground">{when(event.createdAt)}</span>
                </div>
                <span className="break-words text-muted-foreground">
                  {event.rule ? `${event.rule}: ` : ""}
                  {event.message}
                </span>
                <Link href={`/applications/${event.applicationId}`} className="text-primary underline-offset-4 hover:underline">
                  {event.title} at {event.company}
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
