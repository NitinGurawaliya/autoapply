"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the server page while a run is still going. With `versionUrl`, it first asks that small endpoint whether
 * anything changed and re-renders only when the answer differs from `version`, instead of re-rendering the whole
 * page on every tick. Nothing is fetched while the tab is hidden.
 */
export function AutoRefresh({ active, everyMs = 3000, versionUrl, version }: { active: boolean; everyMs?: number; versionUrl?: string; version?: string }) {
  const router = useRouter();
  const seen = useRef(version);
  useEffect(() => {
    seen.current = version;
  }, [version]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      if (!versionUrl) {
        router.refresh();
        return;
      }
      try {
        const response = await fetch(versionUrl, { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { version?: string };
        if (body.version && body.version !== seen.current) {
          seen.current = body.version;
          router.refresh();
        }
      } catch {
        // A missed tick is retried on the next one.
      }
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [active, everyMs, router, versionUrl]);
  return null;
}
