"use client";

import { forgetVisitedPages } from "@/lib/forget-pages";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { explainOutcome } from "@/lib/explain";

const CANCELLABLE = ["queued", "inspecting", "filling", "needs_input"];
const RETRYABLE = ["failed", "cancelled"];
// A waiting-in-line application is harmless to stop; one that has a browser open gets an "are you sure".
const NEEDS_CONFIRM = ["inspecting", "filling", "needs_input"];

// "inline": underlined text on list rows (design/applications.html). "panel": full-width buttons in the detail
// page's "What you can do" card (design/detail.html).
type Props = { id: string; status: string; company: string; onChanged?: () => void; look?: "inline" | "panel"; className?: string };

export function ApplicationActions({ id, status, company, onChanged, look = "inline", className }: Props) {
  const [busy, setBusy] = useState<"cancel" | "retry" | "verify" | null>(null);
  const [confirming, setConfirming] = useState(false);

  // An unanswered "are you sure" goes away by itself.
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 6000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const canCancel = CANCELLABLE.includes(status);
  const canRetry = RETRYABLE.includes(status);
  // Submit may have gone out unconfirmed: the user says whether the employer's email came. No Retry until they do.
  const canVerify = status === "pending_verification";
  if (!canCancel && !canRetry && !canVerify) return null;

  async function call(action: "cancel" | "retry" | "sent" | "not-sent") {
    setBusy(action === "cancel" || action === "retry" ? action : "verify");
    setConfirming(false);
    try {
      const verify = action === "sent" || action === "not-sent";
      const response = await fetch(`/api/applications/${id}/${verify ? "verify" : action}`, {
        method: "POST",
        ...(verify ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sent: action === "sent" }) } : {}),
      });
      const body = (await response.json().catch(() => ({}))) as { blocked?: string; error?: string };
      if (response.ok) {
        const done = { cancel: `Cancelled ${company}`, retry: `Retrying ${company}`, sent: `Marked ${company} as sent`, "not-sent": `Marked ${company} as not sent. You can retry it.` };
        toast.success(done[action]);
        void forgetVisitedPages();
        onChanged?.();
      } else if (response.status === 403 && body.blocked) {
        toast.error(`${company}: ${explainOutcome("blocked", body.blocked).headline}`, { description: `Rule: ${body.blocked}` });
      } else if (response.status === 409) {
        toast.message("That application already changed. Refreshing.");
        void forgetVisitedPages();
        onChanged?.();
      } else {
        toast.error(`Could not update the application for ${company}.`);
      }
    } catch {
      toast.error(`Could not update the application for ${company}.`);
    } finally {
      setBusy(null);
    }
  }

  const panel = look === "panel";
  const main = panel ? { variant: "primary" as const, size: "lg" as const, className: "w-full rounded-field" } : { variant: "underline" as const, size: "text" as const, className: "h-9 text-sm" };
  const second = panel ? { variant: "plain" as const, size: "md" as const, className: "w-full rounded-field" } : { variant: "quiet" as const, size: "text" as const, className: "h-9 text-sm" };

  if (canVerify) {
    return (
      <span className={cn(panel ? "flex w-full flex-col gap-2.5" : "flex items-center gap-3", className)} role="group" aria-label={`Did your application to ${company} arrive?`}>
        <Button type="button" variant={main.variant} size={main.size} className={main.className} disabled={busy !== null} onClick={() => void call("sent")}>
          {busy === "verify" ? "Saving..." : "I got their email"}
        </Button>
        <Button type="button" variant={second.variant} size={second.size} className={second.className} disabled={busy !== null} onClick={() => void call("not-sent")}>
          It was not sent
        </Button>
      </span>
    );
  }

  if (canRetry) {
    return (
      <Button type="button" variant={main.variant} size={main.size} className={cn(main.className, className)} disabled={busy !== null} onClick={() => void call("retry")}>
        {busy === "retry" ? "Retrying..." : "Retry"}
      </Button>
    );
  }

  if (confirming) {
    return (
      <span className={cn(panel ? "flex w-full flex-col gap-2.5" : "flex items-center gap-3", className)} role="group" aria-label={`Confirm cancelling ${company}`}>
        <Button
          type="button"
          variant={panel ? "strong" : "underline"}
          size={panel ? "lg" : "text"}
          className={panel ? "w-full rounded-field" : "h-9 text-sm"}
          disabled={busy !== null}
          onClick={() => void call("cancel")}
        >
          {busy === "cancel" ? "Cancelling..." : "Yes, cancel"}
        </Button>
        <Button type="button" variant={second.variant} size={second.size} className={second.className} onClick={() => setConfirming(false)}>
          Keep running
        </Button>
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant={second.variant}
      size={second.size}
      className={cn(second.className, className)}
      disabled={busy !== null}
      onClick={() => (NEEDS_CONFIRM.includes(status) ? setConfirming(true) : void call("cancel"))}
    >
      Cancel
    </Button>
  );
}
