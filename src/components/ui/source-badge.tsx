import { cn } from "cn";
import { Icon, type IconName } from "@/components/ui/icons";

// Where a filled value came from, drawn as in design/detail.html: icon plus outline, AI draft dashed.
export const SOURCES: Record<string, { label: string; icon: IconName; dashed?: boolean }> = {
  resume: { label: "Resume", icon: "file" },
  user: { label: "You", icon: "person" },
  matched: { label: "You · reused", icon: "person" },
  derived: { label: "Worked out", icon: "file" },
  default: { label: "Default", icon: "target" },
  ai_draft: { label: "AI draft", icon: "pen", dashed: true },
};

export function sourceLabel(source: string) {
  return SOURCES[source]?.label ?? source;
}

export function SourceBadge({ source, className }: { source: string; className?: string }) {
  const meta = SOURCES[source];
  return (
    <span
      data-source-badge={source}
      className={cn(
        "box-border inline-flex h-[26px] flex-none items-center gap-[5px] rounded-full border-[1.5px] border-badge-edge px-[9px] text-xs font-semibold text-foreground",
        meta?.dashed && "border-dashed",
        className,
      )}
    >
      {meta ? <Icon name={meta.icon} size={12} strokeWidth={2.5} /> : null}
      {meta?.label ?? source}
    </span>
  );
}
