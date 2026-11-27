"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { explainOutcome } from "@/lib/explain";

// Apply on an All jobs card (Phase X, X3): the same right swipe the deck sends (POST /api/swipes, every governance check
// unchanged). Shown only on a job that matches the profile; the card then shows what happened in place of the button.
export function BrowseApply({ jobId, company }: { jobId: string; company: string }) {
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "sent"; applicationId: string } | { kind: "blocked"; text: string }>({ kind: "idle" });

  async function apply() {
    setState({ kind: "busy" });
    try {
      const response = await fetch("/api/swipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, direction: "right" }),
      });
      const body = (await response.json().catch(() => ({}))) as { blocked?: string; error?: string; applicationId?: string };
      if (response.ok && body.applicationId) {
        setState({ kind: "sent", applicationId: body.applicationId });
        toast.success(`Your agent is applying to ${company}`);
        return;
      }
      if (response.status === 429) return setState({ kind: "blocked", text: "Your agent is busy: try again in a minute" });
      if (response.status === 400 && body.error === "profile_required") return setState({ kind: "blocked", text: "Finish your profile first" });
      if (response.status === 409) return setState({ kind: "blocked", text: "Already decided" });
      if (response.status === 403 && body.blocked) return setState({ kind: "blocked", text: explainOutcome("blocked", body.blocked).headline });
      throw new Error("save failed");
    } catch {
      setState({ kind: "idle" });
      toast.error(`Could not apply to ${company}`, { description: "Try it again in a moment." });
    }
  }

  if (state.kind === "sent") {
    return (
      <Link href={`/applications/${state.applicationId}`} className="flex h-11 flex-none items-center gap-2 rounded-control px-4 type-body font-semibold text-foreground ring-1 ring-line-strong active:bg-sunk">
        <Icon name="check" size={16} />
        Sent to your agent
      </Link>
    );
  }
  if (state.kind === "blocked") return <span className="flex-none type-meta text-muted-foreground">{state.text}</span>;
  return (
    <Button variant="primary" size="md" className="flex-none" disabled={state.kind === "busy"} aria-busy={state.kind === "busy"} onClick={() => void apply()}>
      {state.kind === "busy" ? "Sending…" : "Apply"}
      {state.kind === "busy" ? null : <Icon name="arrowRight" size={16} />}
    </Button>
  );
}
