import Link from "next/link";
import { cn } from "cn";
import { CompanyMark } from "@/components/ui/marks";
import { SegmentedProgress } from "@/components/ui/segmented-progress";
import { STAGES } from "@/lib/status-meta";

/**
 * The dark card that drops in after a right swipe and follows the application through its four stages.
 * `stage` is 0 (waiting in line) to 3 (submitted); the caller decides when it shows and hides.
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
  return (
    <Link
      href={href}
      aria-live="polite"
      aria-hidden={!visible}
      tabIndex={visible ? undefined : -1}
      data-agent-toast=""
      className={cn(
        "box-border flex flex-col gap-3 rounded-panel bg-inverse px-3.5 pt-3 pb-3.5 text-inverse-foreground no-underline shadow-float transition-[transform,opacity] duration-[380ms] ease-pop",
        visible ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-[18px] scale-[0.97] opacity-0",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <CompanyMark name={company} size={36} tone="accent" />
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-[15px] font-semibold">{company}</span>
          <span className="text-[13px] opacity-80">{STAGES[Math.max(0, Math.min(3, stage))]}</span>
        </div>
        <span className="text-[13px] font-semibold underline underline-offset-3">View</span>
      </div>
      <SegmentedProgress count={4} done={Math.max(0, Math.min(3, stage)) + 1} tone="toast" thickness={4} />
    </Link>
  );
}
