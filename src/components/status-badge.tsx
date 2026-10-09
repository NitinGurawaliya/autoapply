import { Badge } from "@/components/ui/badge";

// queued gray · inspecting/filling blue animated · needs_input amber · submitted green · failed red · blocked red outline
const STATUS: Record<string, { label: string; className: string; variant?: "outline" }> = {
  queued: { label: "Queued", className: "bg-muted text-muted-foreground" },
  inspecting: { label: "Reading form", className: "bg-info-soft text-info animate-pulse" },
  filling: { label: "Filling", className: "bg-info-soft text-info animate-pulse" },
  needs_input: { label: "Needs your input", className: "bg-warning-soft text-warning" },
  submitted: { label: "Submitted", className: "bg-success-soft text-success" },
  failed: { label: "Failed", className: "bg-danger-soft text-danger" },
  cancelled: { label: "Cancelled", className: "bg-transparent text-muted-foreground", variant: "outline" },
  blocked: { label: "Blocked", className: "border-danger bg-transparent text-danger", variant: "outline" },
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return (
    <Badge variant={style.variant ?? "secondary"} className={style.className}>
      {style.label}
    </Badge>
  );
}

// resume gray · you blue · you reused blue outline · worked out gray outline · AI draft purple · default outline
const SOURCE: Record<string, { label: string; className: string; variant?: "outline" }> = {
  resume: { label: "Resume", className: "bg-muted text-muted-foreground" },
  user: { label: "You", className: "bg-info-soft text-info" },
  // Your answer to another wording of the question, verified for this job (modules/apply/recall.ts).
  matched: { label: "You · reused", className: "border-info/40 bg-transparent text-info", variant: "outline" },
  // Worked out from your profile or resume, with the evidence shown beside it (modules/apply/derive.ts).
  derived: { label: "Worked out", className: "bg-transparent text-muted-foreground", variant: "outline" },
  ai_draft: { label: "AI draft", className: "bg-ai-soft text-ai" },
  default: { label: "Default", className: "bg-transparent text-foreground", variant: "outline" },
};

export function SourceBadge({ source }: { source: string }) {
  const style = SOURCE[source] ?? { label: source, className: "bg-muted text-muted-foreground" };
  return (
    <Badge variant={style.variant ?? "secondary"} className={style.className}>
      {style.label}
    </Badge>
  );
}
