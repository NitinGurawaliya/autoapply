"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

/** The small two-card mark next to the wordmark: a quiet card and the accent card in front, offset, no tilt. */
export function LogoMark() {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden="true" className="relative size-7">
        <span className="absolute top-0.5 left-0 h-6 w-4.5 rounded-tag border border-line-strong bg-surface" />
        <span className="absolute top-0.5 left-2.5 h-6 w-4.5 rounded-tag bg-primary" />
      </span>
      <span className="type-section font-semibold">swipeapply</span>
    </span>
  );
}

/**
 * The opening animation: two cards settle in, the front one slides right, then the wordmark. Short ease-outs only
 * (Direction B: no bounce). Calls `onDone` when it has played, or when Continue is tapped.
 */
export function OpeningSplash({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setPhase(1), 200),
      window.setTimeout(() => setPhase(2), 900),
      window.setTimeout(() => setPhase(3), 1300),
      window.setTimeout(onDone, 2500),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-50 mx-auto flex max-w-120 flex-col bg-splash text-foreground">
      <div className="flex flex-1 flex-col items-center justify-center gap-8 pb-10">
        <div aria-hidden="true" className="relative h-30 w-40">
          <div
            className={cn(
              "absolute top-2 left-10 h-25 w-19 rounded-card bg-surface shadow-lift transition-[transform,opacity] duration-500 ease-calm",
              phase >= 1 ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
            )}
          />
          <div
            className={cn(
              "absolute top-4 left-13 flex h-25 w-19 items-center justify-center rounded-card bg-splash-card text-splash-card-ink shadow-lift transition-[transform,opacity] duration-500 ease-calm",
              phase >= 2 ? "translate-x-8 opacity-100" : phase >= 1 ? "translate-x-0 opacity-100" : "translate-y-3 opacity-0",
            )}
          >
            <Icon name="check" size={32} />
          </div>
        </div>
        <div
          className={cn(
            "flex flex-col items-center gap-2 transition-[transform,opacity] duration-400 ease-calm",
            phase >= 3 ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
          )}
        >
          <span className="type-score font-semibold">swipeapply</span>
          <span className="type-body text-muted-foreground">Swipe right. We apply.</span>
        </div>
      </div>
      <div className="flex justify-center pb-10">
        <Button variant="underline" size="text" onClick={onDone}>
          Continue
        </Button>
      </div>
    </div>
  );
}
