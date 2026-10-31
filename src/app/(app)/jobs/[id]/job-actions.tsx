"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { explainOutcome } from "@/lib/explain";
import { markSwiped } from "../../feed/swipe-deck";

/** Skip or Apply from the job's page: the same swipe the deck sends, then back to the feed without this card. */
export function JobActions({ jobId, company, backHref }: { jobId: string; company: string; backHref: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"left" | "right" | null>(null);

  async function send(direction: "left" | "right") {
    if (busy) return;
    setBusy(direction);
    try {
      const response = await fetch("/api/swipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, direction }),
      });
      const body = (await response.json().catch(() => ({}))) as { blocked?: string; error?: string; applicationId?: string };
      if (response.status === 429) {
        toast.error("Your agent is busy", { description: "Several applications are still on the way. Try again in a minute." });
        return;
      }
      if (response.status === 403 && body.blocked) {
        const outcome = explainOutcome("blocked", body.blocked);
        markSwiped(jobId);
        toast.error(`${company}: ${outcome.headline}`, { description: outcome.next ?? undefined });
        router.push(backHref);
        return;
      }
      if (response.status === 409 && body.error === "already_swiped") {
        markSwiped(jobId);
        router.push(backHref);
        return;
      }
      if (response.status === 400 && body.error === "profile_required") {
        toast.error("Finish your profile first", { description: "Your agent needs your resume before it can apply." });
        return;
      }
      if (!response.ok) throw new Error("save failed");
      markSwiped(jobId);
      if (direction === "right" && body.applicationId) {
        const applicationId = body.applicationId;
        toast.success(`Your agent is applying to ${company}`, {
          action: { label: "Follow it", onClick: () => router.push(`/applications/${applicationId}`) },
        });
      }
      router.push(backHref);
    } catch {
      toast.error(`Could not save that for ${company}. Try again.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex gap-3">
      <Button variant="line" size="xl" className="flex-1" disabled={busy !== null} onClick={() => void send("left")}>
        <Icon name="close" size={20} strokeWidth={2.25} />
        Skip
      </Button>
      <Button variant="primary" size="xl" className="flex-[2]" disabled={busy !== null} onClick={() => void send("right")}>
        <Icon name="check" size={22} strokeWidth={2.5} />
        {busy === "right" ? "Sending to your agent" : "Apply"}
      </Button>
    </div>
  );
}
