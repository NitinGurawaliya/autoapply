import { cn } from "cn";
import { Icon, type IconName } from "@/components/ui/icons";

// Where a filled value came from: icon plus a hairline outline; AI draft and best guess dashed (Direction B, Phase O3).
export const SOURCES: Record<string, { label: string; icon: IconName; dashed?: boolean }> = {
  resume: { label: "Resume", icon: "file" },
  user: { label: "You", icon: "person" },
  matched: { label: "You · reused", icon: "person" },
  derived: { label: "Worked out", icon: "file" },
  default: { label: "Default", icon: "target" },
  ai_draft: { label: "AI draft", icon: "pen", dashed: true },
  // Guess and send (modules/apply/guess.ts): the agent's best guess where nothing settled the answer, with its reason.
  guessed: { label: "Best guess", icon: "agent", dashed: true },
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
        "box-border inline-flex h-6 flex-none items-center gap-1 rounded-tag border border-badge-edge px-2 type-meta font-medium text-foreground",
        meta?.dashed && "border-dashed",
        className,
      )}
    >
      {meta ? <Icon name={meta.icon} size={12} /> : null}
      {meta?.label ?? source}
    </span>
  );
}
