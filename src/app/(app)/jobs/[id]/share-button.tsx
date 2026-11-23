"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Share this job (Phase U9): the phone's share sheet where the browser has one, else the link is copied. The link is
 * the job's public page with `?s=app` (shared from the app; the owner's own posts use `scripts/share-link.ts --s li`).
 */
export function ShareButton({ url, title }: { url: string; title: string }) {
  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // Closing the share sheet is not a failure; anything else falls through to copying.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied", { description: "Anyone with it can see this job and apply." });
    } catch {
      toast.error("Couldn't copy the link", { description: url });
    }
  }

  return (
    <Button variant="quiet" size="text" className="min-h-11 px-2" onClick={() => void share()}>
      Share
    </Button>
  );
}
