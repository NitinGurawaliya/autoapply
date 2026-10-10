import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { EVENT_LABEL } from "@/lib/event-labels";
import { explainOutcome } from "@/lib/explain";
import { describeRules } from "@/lib/rule-text";
import { governanceOverview } from "@/modules/governance";
import { SoftChip } from "@/components/ui/chip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Icon } from "@/components/ui/icons";
import { TitleTopBar } from "@/components/patterns/top-bar";

export const dynamic = "force-dynamic";

function when(date: Date) {
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="box-border flex flex-col gap-1 rounded-[18px] border-[1.5px] border-line bg-surface p-3.5" data-stat={label}>
      <span className="font-display text-[28px] leading-none font-extrabold tracking-[-0.035em]">{value}</span>
      <span className="text-[13px] font-semibold">{label}</span>
      {hint ? <span className="text-xs leading-[1.4] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

const card = "m-0 flex list-none flex-col rounded-panel border-[1.5px] border-line bg-surface px-4 py-1";
const row = "flex flex-col gap-1 border-t border-line py-3 first:border-t-0";

export default async function GovernancePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const overview = await governanceOverview(user.id);
  const rules = describeRules(overview.rules);
  const { counters } = overview;

  return (
    <>
      <TitleTopBar
        title="Governance"
        sub="The rules the agent has to obey, enforced in code, not just in instructions. Every decision it makes is written down below."
      />
      <div className="flex flex-col gap-[22px] px-5 pt-4 pb-6">
        <section className="flex flex-col gap-2.5" aria-label="Today">
          <Eyebrow as="h2">Today</Eyebrow>
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="Started" value={`${counters.started} of ${counters.cap}`} hint="Applications begun, against the daily limit" />
            <Stat label="Submitted" value={String(counters.submitted)} hint="Sent to a company" />
            <Stat label="Blocked" value={String(counters.blocked)} hint="Stopped by a rule" />
            <Stat label="Questions asked" value={String(counters.asked)} hint="Times it paused to ask you" />
            <Stat label="Answered from your data" value={String(counters.fromData)} hint="Reused, worked out or drafted instead of asking" />
            <Stat label="Rule checks" value={String(counters.checks)} hint="Every one is logged" />
          </div>
          <p className="m-0 text-xs text-muted-foreground">Days run on UTC.</p>
        </section>

        <section className="flex flex-col gap-2.5" aria-label="Rules">
          <Eyebrow as="h2">Rules in force · {rules.length}</Eyebrow>
          <ul className={card}>
            {rules.map((rule) => (
              <li key={rule.id} className={row} data-rule={rule.id}>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[15px] font-semibold">{rule.title}</span>
                  <SoftChip className="h-[30px] shrink-0 text-[13px]">{rule.value}</SoftChip>
                </div>
                <span className="text-[13px] leading-[1.45] text-muted-foreground">{rule.meaning}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2.5" aria-label="What was blocked">
          <Eyebrow as="h2">What was blocked, and why</Eyebrow>
          {overview.blocks.length === 0 ? (
            <p className="m-0 rounded-[18px] border-[1.5px] border-dashed border-dash px-4 py-4 text-sm text-muted-foreground">
              Nothing has been blocked. When a rule stops an application, it shows up here with the reason.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {overview.blocks.map((block) => {
                const why = explainOutcome("blocked", block.rule);
                return (
                  <li key={block.id} className="rounded-[18px] border-[1.5px] border-dashed border-dash" data-block-rule={block.rule ?? ""}>
                    <Link href={`/applications/${block.applicationId}`} className="flex flex-col gap-1 px-3.5 py-3 text-foreground no-underline">
                      <span className="text-[15px] font-semibold">
                        {block.title} <span className="font-normal text-muted-foreground">at {block.company}</span>
                      </span>
                      <span className="flex items-start gap-1.5 text-[13px]">
                        <Icon name="info" size={14} strokeWidth={2.25} className="mt-0.5 flex-none" />
                        <span>
                          <span className="font-semibold">{why.headline}.</span> <span className="text-muted-foreground">{block.message}</span>
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Rule: {block.rule ?? "unknown"} · {when(block.createdAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2.5" aria-label="Latest decisions">
          <Eyebrow as="h2">Latest decisions</Eyebrow>
          {overview.events.length === 0 ? (
            <p className="m-0 rounded-[18px] border-[1.5px] border-dashed border-dash px-4 py-4 text-sm text-muted-foreground">
              Nothing yet. Swipe right on a job and each step is recorded here.
            </p>
          ) : (
            <ol className={card}>
              {overview.events.map((event) => (
                <li key={event.id} className={row} data-event-type={event.type}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                      {event.type === "block" || event.type === "error" ? <Icon name="info" size={14} strokeWidth={2.25} /> : null}
                      {EVENT_LABEL[event.type] ?? event.type}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{when(event.createdAt)}</span>
                  </div>
                  <span className="text-[13px] break-words text-muted-foreground">
                    {event.rule ? `${event.rule}: ` : ""}
                    {event.message}
                  </span>
                  <Link href={`/applications/${event.applicationId}`} className="self-start text-[13px] font-semibold text-foreground underline underline-offset-3">
                    {event.title} at {event.company}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
