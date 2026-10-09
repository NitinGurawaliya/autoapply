"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-reads the server page every few seconds while a run is still going. */
export function AutoRefresh({ active, everyMs = 3000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), everyMs);
    return () => window.clearInterval(timer);
  }, [active, everyMs, router]);
  return null;
}
