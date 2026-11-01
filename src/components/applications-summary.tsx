"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type WaitingApplication = {
  id: string;
  company: string;
  title: string;
  waitingFor: "code" | "answers";
  promptId: string | null;
};

export type SentApplication = { id: string; company: string; logoUrl: string | null; title: string; submittedAt: number };
export type SentNews = { sent: SentApplication[]; sentTotal: number | null; sentThisWeek: number | null };

type SummaryState = {
  /** Null until the first poll returns. */
  waiting: WaitingApplication[] | null;
  /** Applications sent since the last "Sent!" moment this device showed (components/sent-celebration.tsx). */
  sent: SentNews | null;
  /** The moment was shown for everything sent up to `submittedAt`: never show those again on this device. */
  celebrated: (submittedAt: number) => void;
  /** Poll now, e.g. right after the user answered something. */
  refresh: () => void;
};

const POLL_MS = 5000;
// Until when this device has shown the "Sent!" moment (ms). A first visit starts from now, so it never replays history.
const CELEBRATED_KEY = "swipeapply:celebrated-until";
const SummaryContext = createContext<SummaryState>({ waiting: null, sent: null, celebrated: () => undefined, refresh: () => undefined });

function readCelebrated(): number {
  try {
    const stored = Number(localStorage.getItem(CELEBRATED_KEY));
    if (Number.isFinite(stored) && stored > 0) return stored;
    const now = Date.now();
    localStorage.setItem(CELEBRATED_KEY, String(now));
    return now;
  } catch {
    // Storage blocked: this tab's own start, so at least nothing old is shown.
    return Date.now();
  }
}

/**
 * The one poller in the shell. The nav badge, the tab-title badge and notifications, and the input popup all read
 * from it, so an open tab sends one small request every few seconds, and none while the tab is hidden.
 */
export function ApplicationsSummaryProvider({ children }: { children: React.ReactNode }) {
  const [waiting, setWaiting] = useState<WaitingApplication[] | null>(null);
  const [sent, setSent] = useState<SentNews | null>(null);
  const inFlight = useRef(false);
  const since = useRef<number | null>(null);

  const poll = useCallback(async () => {
    if (inFlight.current || document.visibilityState === "hidden") return;
    inFlight.current = true;
    try {
      since.current ??= readCelebrated();
      // A request that hangs must not block every later tick behind the in-flight guard.
      const response = await fetch(`/api/applications/summary?since=${since.current}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return;
      const body = (await response.json()) as { waiting: WaitingApplication[] } & Partial<SentNews>;
      setWaiting(body.waiting);
      // Only news replaces news: an empty answer while a moment is on screen must not take it away.
      if (body.sent && body.sent.length > 0) setSent({ sent: body.sent, sentTotal: body.sentTotal ?? null, sentThisWeek: body.sentThisWeek ?? null });
    } catch {
      // Keep the last known state; the next tick tries again.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    // poll() sets state only after its fetch resolves (subscribing to an external source), not synchronously.
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  const celebrated = useCallback((submittedAt: number) => {
    since.current = Math.max(since.current ?? 0, submittedAt);
    try {
      localStorage.setItem(CELEBRATED_KEY, String(since.current));
    } catch {
      // Storage blocked: this tab still remembers it.
    }
    setSent(null);
  }, []);

  const refresh = useCallback(() => void poll(), [poll]);
  return <SummaryContext.Provider value={{ waiting, sent, celebrated, refresh }}>{children}</SummaryContext.Provider>;
}

export function useApplicationsSummary() {
  return useContext(SummaryContext);
}
