"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

/** The small two-card logo next to the wordmark (design/start.html). */
export function LogoMark() {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden="true" className="relative size-[30px]">
        <span className="absolute top-0.5 left-[3px] box-border h-[23px] w-[17px] -rotate-10 rounded-[5px] border-2 border-edge bg-surface" />
        <span className="absolute top-1 left-[9px] box-border h-[23px] w-[17px] rotate-10 rounded-[5px] border-2 border-ink bg-primary" />
      </span>
      <span className="font-display text-[22px] font-extrabold tracking-[-0.04em]">swipeapply</span>
    </span>
  );
}

/**
 * The opening animation (design/start.html board 01): two cards drop in, the front one swipes right, then the
 * wordmark. Calls `onDone` when it has played, or when Continue is tapped.
 */
export function OpeningSplash({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setPhase(1), 250),
      window.setTimeout(() => setPhase(2), 1050),
      window.setTimeout(() => setPhase(3), 1500),
      window.setTimeout(onDone, 2900),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-50 mx-auto flex max-w-[480px] flex-col bg-splash text-foreground">
      <div className="flex flex-1 flex-col items-center justify-center gap-7 pb-10">
        <div aria-hidden="true" className="relative h-[150px] w-[170px]">
          <div
            className={cn(
              "absolute top-[18px] left-10 box-border h-[100px] w-[76px] rounded-[18px] border-3 border-foreground bg-surface transition-[transform,opacity] duration-[560ms,220ms] ease-bounce",
              phase >= 1 ? "-rotate-10 opacity-100" : "scale-60 -rotate-10 opacity-0",
            )}
          />
          <div
            className={cn(
              "absolute top-[26px] left-[52px] box-border flex h-[100px] w-[76px] items-center justify-center rounded-[18px] border-3 border-splash-card bg-splash-card text-splash-card-ink transition-[transform,opacity] duration-[620ms,220ms] ease-bounce",
              phase >= 2 ? "translate-x-[30px] rotate-14 opacity-100" : phase >= 1 ? "rotate-0 opacity-100" : "scale-60 opacity-0",
            )}
          >
            <Icon name="check" size={40} strokeWidth={3} />
          </div>
        </div>
        <div
          className={cn(
            "flex flex-col items-center gap-2 transition-[transform,opacity] duration-[480ms,380ms] ease-settle",
            phase >= 3 ? "translate-y-0 opacity-100" : "translate-y-3.5 opacity-0",
          )}
        >
          <span className="font-display text-[44px] leading-none font-extrabold tracking-[-0.045em]">swipeapply</span>
          <span className="text-[17px] font-medium">Swipe right. We apply.</span>
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
