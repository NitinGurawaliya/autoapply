import Link from "next/link";
import { cn } from "cn";
import { AgentStatus } from "@/components/patterns/agent-status";
import { STAGES } from "@/lib/status-meta";

/**
 * The dark card that drops in after a right swipe: the agent at work on that application, in its own words.
 * `stage` is 0 (getting ready) to 3 (sent); the caller decides when it shows and hides.
 */
export function AgentToast({
  company,
  stage,
  href,
  visible,
  className,
}: {
  company: string;
  stage: number;
  href: string;
  visible: boolean;
  className?: string;
}) {
  const at = Math.max(0, Math.min(3, stage));
  const sent = at === 3;
  return (
    <Link
      href={href}
      aria-hidden={!visible}
      tabIndex={visible ? undefined : -1}
      data-agent-toast=""
      className={cn(
        "box-border flex items-center gap-3 rounded-panel bg-inverse px-3.5 py-3 text-inverse-foreground no-underline shadow-float transition-[transform,opacity] duration-[380ms] ease-pop",
        visible ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-[18px] scale-[0.97] opacity-0",
        className,
      )}
    >
      <AgentStatus
        className="min-w-0 flex-1"
        text={sent ? `Sent to ${company}` : `Applying to ${company}`}
        detail={sent ? "Your agent submitted it" : STAGES[at]}
        active={!sent}
      />
      <span className="text-[13px] font-semibold underline underline-offset-3">View</span>
    </Link>
  );
}
