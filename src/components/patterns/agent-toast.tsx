import Link from "next/link";
import { cn } from "cn";
import { AccentPill } from "@/components/ui/chip";
import { AgentAvatar, AgentStatus } from "@/components/patterns/agent-status";
import { explainOutcome } from "@/lib/explain";
import { STAGES, statusMeta } from "@/lib/status-meta";

/**
 * The dark card that drops in after a right swipe: the agent at work on that application, in its own words, until the
 * outcome. In progress: "Applying to X" and the stage (`stage` 0 getting ready to 3 sent). Sent: "Sent to X". Needs you:
 * the lime "Needs you" and "Answer". Didn't go through (blocked, failed, cancelled): a dashed outline and why.
 * `href` is null until the swipe is saved (no application yet); the caller decides when it shows and hides.
 */
export function AgentToast({
  company,
  stage,
  status = "queued",
  error = null,
  detail,
  href,
  visible,
  className,
}: {
  company: string;
  stage: number;
  status?: string;
  error?: string | null;
  /** Overrides the outcome's words (a swipe that could not be saved has no application to explain). */
  detail?: string;
  href: string | null;
  visible: boolean;
  className?: string;
}) {
  const group = statusMeta(status).group;
  const at = Math.max(0, Math.min(3, stage));
  const outcome = explainOutcome(status, error);

  let body;
  let action: string | null = "View";
  if (group === "sent") {
    body = <AgentStatus className="min-w-0 flex-1" text={`Sent to ${company}`} detail="Your agent submitted it" active={false} />;
  } else if (group === "failed") {
    body = <AgentStatus className="min-w-0 flex-1" text="Didn't go through" detail={`${detail ?? outcome.headline} · ${company}`} active={false} />;
  } else if (group === "needs") {
    action = "Answer";
    // The lime pill sits beside the company, so the question's line keeps the width.
    body = (
      <div role="status" aria-live="polite" className="flex min-w-0 flex-1 items-center gap-3">
        <AgentAvatar active={false} />
        <span className="flex min-w-0 flex-col gap-px">
          <span className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
            <span className="truncate">{company}</span>
            <AccentPill className="h-6 flex-none px-2.5 text-xs">Needs you</AccentPill>
          </span>
          <span className="truncate text-[13px] opacity-75">{detail ?? outcome.headline}</span>
        </span>
      </div>
    );
  } else {
    body = <AgentStatus className="min-w-0 flex-1" text={`Applying to ${company}`} detail={STAGES[at]} active />;
  }

  const classes = cn(
    "box-border flex items-center gap-3 rounded-panel border-[1.5px] bg-inverse px-3.5 py-3 text-inverse-foreground no-underline shadow-float transition-[transform,opacity] duration-[380ms] ease-pop",
    group === "failed" ? "border-dashed border-dash" : "border-transparent",
    visible ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-[18px] scale-[0.97] opacity-0",
    className,
  );

  if (!href) {
    // The swipe is still being saved: nothing to open yet.
    return (
      <div aria-hidden={!visible} data-agent-toast="" data-status={status} className={classes}>
        {body}
      </div>
    );
  }
  return (
    <Link href={href} aria-hidden={!visible} tabIndex={visible ? undefined : -1} data-agent-toast="" data-status={status} className={classes}>
      {body}
      {action ? <span className="flex-none text-[13px] font-semibold underline underline-offset-3">{action}</span> : null}
    </Link>
  );
}
