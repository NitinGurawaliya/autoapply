"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { explainOutcome } from "@/lib/explain";
import { markSwiped, unmarkSwiped } from "../../feed/swipe-deck";
import { markOpenedFromFeed, openedFromFeed } from "./feed-back-link";

/** The job after this one in the same feed (page.tsx), with its page's address. */
export type NextJob = { id: string; href: string; company: string; title: string };

/**
 * Skip or Apply from the job's page: the same swipe the deck sends, then on to the next job's page, as the deck moves
 * on to the next card (1 Nov, owner: applying from a job page must not drop the user back on the feed). The next page
 * replaces this one in the history, so Back still goes to the feed. With no job left, back to the feed, which says so.
 */
export function JobActions({ jobId, company, backHref, next }: { jobId: string; company: string; backHref: string; next: NextJob | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"left" | "right" | null>(null);

  function moveOn(direction: "left" | "right") {
    markSwiped(jobId, direction);
    const viaFeed = openedFromFeed(jobId);
    if (next) {
      // The next page's Back goes through history to the feed too (feed-back-link.tsx).
      if (viaFeed) markOpenedFromFeed(next.id);
      router.replace(next.href);
    } else if (viaFeed && window.history.length > 1) router.back();
    else router.push(backHref);
  }

  /**
   * Moves on at once, as the deck does with its card, and saves the swipe on the way: the next page is already loaded
   * (prefetched), so waiting for the save (a right swipe takes seconds) would only hold the user here. The outcome
   * follows as a toast; a swipe that was not saved puts the job back in the feed and says so.
   */
  async function send(direction: "left" | "right") {
    if (busy) return;
    setBusy(direction);
    const saving = fetch("/api/swipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, direction }),
    });
    moveOn(direction);
    const notSaved = (title: string, description: string) => {
      unmarkSwiped(jobId);
      toast.error(title, { description });
    };
    try {
      const response = await saving;
      const body = (await response.json().catch(() => ({}))) as { blocked?: string; error?: string; applicationId?: string };
      if (response.status === 429) return notSaved("Your agent is busy", `${company} is back in your feed. Several applications are still on the way; try it again in a minute.`);
      if (response.status === 400 && body.error === "profile_required") return notSaved("Finish your profile first", "Your agent needs your resume before it can apply.");
      if (response.status === 403 && body.blocked) {
        const outcome = explainOutcome("blocked", body.blocked);
        toast.error(`${company}: ${outcome.headline}`, { description: outcome.next ?? undefined });
        return;
      }
      if (response.status === 409 && body.error === "already_swiped") return;
      if (!response.ok) throw new Error("save failed");
      if (direction === "right" && body.applicationId) {
        const applicationId = body.applicationId;
        toast.success(`Your agent is applying to ${company}`, {
          action: { label: "Follow it", onClick: () => router.push(`/applications/${applicationId}`) },
        });
      }
    } catch {
      notSaved(`Could not save that for ${company}`, "It is back in your feed. Try again from there.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {next ? (
        <>
          {/* What Apply or Skip leads to. Shown, and loaded ahead in full (prefetch) so it opens at once, but not a
              way past this job: like a card in the deck, it is passed only by deciding. */}
          <p className="m-0 flex min-w-0 items-baseline gap-1.5 type-caption text-muted-foreground">
            <span className="flex-none">Up next</span>
            <span className="truncate font-semibold text-foreground">
              {next.company} · {next.title}
            </span>
          </p>
          <Link href={next.href} prefetch aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute size-px overflow-hidden opacity-0">
            {next.title}
          </Link>
        </>
      ) : (
        <p className="m-0 type-caption text-muted-foreground">The last job in your feed for now</p>
      )}
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
    </div>
  );
}

/** "Next job" for a page that is already decided (applied, skipped or closed): the same next page, prefetched. */
export function NextJobLink({ jobId, next, className }: { jobId: string; next: NextJob; className?: string }) {
  return (
    <Link
      href={next.href}
      prefetch
      replace
      className={className}
      onClick={() => {
        if (openedFromFeed(jobId)) markOpenedFromFeed(next.id);
      }}
    >
      Next job
      <Icon name="chevronRight" size={18} strokeWidth={2.5} />
    </Link>
  );
}
