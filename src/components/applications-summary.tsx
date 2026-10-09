"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type WaitingApplication = {
  id: string;
  company: string;
  title: string;
  waitingFor: "code" | "answers";
  promptId: string | null;
};

type SummaryState = {
  /** Null until the first poll returns. */
  waiting: WaitingApplication[] | null;
  /** Poll now, e.g. right after the user answered something. */
  refresh: () => void;
};

const POLL_MS = 5000;
const SummaryContext = createContext<SummaryState>({ waiting: null, refresh: () => undefined });

/**
 * The one poller in the shell. The nav badge, the tab-title badge and notifications, and the input popup all read
 * from it, so an open tab sends one small request every few seconds, and none while the tab is hidden.
 */
export function ApplicationsSummaryProvider({ children }: { children: React.ReactNode }) {
  const [waiting, setWaiting] = useState<WaitingApplication[] | null>(null);
  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    if (inFlight.current || document.visibilityState === "hidden") return;
    inFlight.current = true;
    try {
      // A request that hangs must not block every later tick behind the in-flight guard.
      const response = await fetch("/api/applications/summary", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return;
      const body = (await response.json()) as { waiting: WaitingApplication[] };
      setWaiting(body.waiting);
    } catch {
      // Keep the last known state; the next tick tries again.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    // poll() sets state only after its fetch resolves (subscribing to an external source), not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const refresh = useCallback(() => void poll(), [poll]);
  return <SummaryContext.Provider value={{ waiting, refresh }}>{children}</SummaryContext.Provider>;
}

export function useApplicationsSummary() {
  return useContext(SummaryContext);
}
