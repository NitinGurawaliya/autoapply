"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Set by the feed's deck when it opens a job (feed/swipe-deck.tsx markOpenedFromFeed).
const OPENED_FROM_FEED = "swipeapply:opened-from-feed";

/** The deck calls this as it opens a job's page, so that page's Back can return through the browser's history. */
export function markOpenedFromFeed(jobId: string) {
  try {
    sessionStorage.setItem(OPENED_FROM_FEED, jobId);
  } catch {
    // Storage blocked: Back is an ordinary link to the feed.
  }
}

/**
 * Back to the feed. Opened from the deck, it goes back through the browser's history, which restores the feed the user
 * left at once, with its cards, from the router's cache, however long they spent here (1 Nov: a link to the feed cost
 * a server render whenever the feed was not in the cache). Reached any other way (a shared link, a reload, back from
 * another tab), it is an ordinary link to the feed with the same filters. The mark is taken once, on arrival, so a
 * later visit to this page through history does not jump to whatever page came before it.
 */
export function FeedBackLink({ jobId, href, className, ariaLabel, children }: { jobId: string; href: string; className?: string; ariaLabel?: string; children: ReactNode }) {
  const router = useRouter();
  // Read only when Back is pressed, so a ref, not state.
  const fromFeed = useRef(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(OPENED_FROM_FEED) !== jobId) return;
      sessionStorage.removeItem(OPENED_FROM_FEED);
      // Only ever set to true: React runs this twice in development, and the second run finds the mark already taken.
      fromFeed.current = true;
    } catch {
      // Storage blocked: stay an ordinary link.
    }
  }, [jobId]);

  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={className}
      onClick={(event) => {
        if (!fromFeed.current || window.history.length < 2 || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        router.back();
      }}
    >
      {children}
    </Link>
  );
}
