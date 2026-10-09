"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const CANCELLABLE = ["queued", "inspecting", "filling", "needs_input"];
const RETRYABLE = ["failed", "cancelled"];
// A waiting-in-line application is harmless to stop; one that has a browser open gets an "are you sure".
const NEEDS_CONFIRM = ["inspecting", "filling", "needs_input"];

type Props = { id: string; status: string; company: string; onChanged?: () => void };

export function ApplicationActions({ id, status, company, onChanged }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"cancel" | "retry" | null>(null);
  const [confirming, setConfirming] = useState(false);

  // An unanswered "are you sure" goes away by itself.
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 6000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const canCancel = CANCELLABLE.includes(status);
  const canRetry = RETRYABLE.includes(status);
  if (!canCancel && !canRetry) return null;

  async function call(action: "cancel" | "retry") {
    setBusy(action);
    setConfirming(false);
    try {
      const response = await fetch(`/api/applications/${id}/${action}`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { blocked?: string; error?: string };
      if (response.ok) {
        toast.success(action === "cancel" ? `Cancelled ${company}` : `Retrying ${company}`);
        if (onChanged) onChanged();
        else router.refresh();
      } else if (response.status === 403 && body.blocked) {
        toast.error(`${company}: blocked by rule ${body.blocked}`);
      } else if (response.status === 409) {
        toast.message("That application already changed. Refreshing.");
        if (onChanged) onChanged();
        else router.refresh();
      } else {
        toast.error(`Could not ${action} the application for ${company}.`);
      }
    } catch {
      toast.error(`Could not ${action} the application for ${company}.`);
    } finally {
      setBusy(null);
    }
  }

  if (canRetry) {
    return (
      <Button type="button" size="sm" disabled={busy !== null} onClick={() => void call("retry")}>
        {busy === "retry" ? "Retrying..." : "Retry"}
      </Button>
    );
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-2" role="group" aria-label={`Confirm cancelling ${company}`}>
        <Button type="button" size="sm" variant="destructive" disabled={busy !== null} onClick={() => void call("cancel")}>
          {busy === "cancel" ? "Cancelling..." : "Yes, cancel"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(false)}>
          Keep running
        </Button>
      </span>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={busy !== null}
      onClick={() => (NEEDS_CONFIRM.includes(status) ? setConfirming(true) : void call("cancel"))}
    >
      Cancel
    </Button>
  );
}
