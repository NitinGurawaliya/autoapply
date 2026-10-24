import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icons";
import { ProfileMenu } from "@/components/patterns/profile-menu";

// The three top bars of the design. The 54 px phone status bar in the boards is the device's, so the page starts
// below the safe area instead.

/** Discover: profile on the left, then the daily usage pill and the filters button on the right. */
export function FeedTopBar({ usage, filters }: { usage: ReactNode; filters: ReactNode }) {
  return (
    <header className="flex h-11 flex-none items-center gap-2.5 px-5">
      <ProfileMenu align="left" />
      <div className="flex-1" />
      {usage}
      {filters}
    </header>
  );
}

/** "Applications": a big title with the profile on the right, and a line under it. */
export function TitleTopBar({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <header className="flex flex-none flex-col gap-1 px-5">
      <div className="flex h-11 items-center">
        <h1 className="m-0 flex-1 type-display-lg">{title}</h1>
        <ProfileMenu align="right" />
      </div>
      {sub ? <span className="text-sm text-muted-foreground">{sub}</span> : null}
    </header>
  );
}

/** Detail pages: a back arrow and a short label. */
export function BackTopBar({ href, label, backLabel }: { href: string; label: string; backLabel: string }) {
  return (
    <div className="flex h-11 flex-none items-center gap-1 px-3">
      <Link href={href} aria-label={backLabel} className="flex size-11 items-center justify-center rounded-full text-foreground">
        <Icon name="back" size={22} strokeWidth={2.25} />
      </Link>
      <span className="text-base font-semibold">{label}</span>
    </div>
  );
}

/**
 * "18 sent today": what the agent has done today. The cap shows only as it comes near (5 or fewer left) or is reached,
 * so the header reads as the agent's work, not a quota (24 Oct, owner).
 */
export function UsagePill({ used, cap }: { used: number; cap: number }) {
  const percent = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const near = cap - used <= 5;
  return (
    <div
      data-daily-usage=""
      className="box-border flex h-9 items-center gap-2 rounded-full border-[1.5px] border-line bg-surface px-3"
      title={used >= cap ? "Daily limit reached. It resets at midnight UTC." : undefined}
    >
      <span className="text-sm font-semibold tabular-nums">
        {used}
        <span className="font-medium text-muted-foreground"> {near ? (used >= cap ? "· done for today" : `· ${cap - used} left`) : "sent today"}</span>
      </span>
      <span className="sr-only">{used >= cap ? ". Daily limit reached." : ""}</span>
      {near ? (
        <span aria-hidden="true" className="block h-1 w-8 overflow-hidden rounded-full bg-track">
          <span className="block h-full bg-bar transition-[width] duration-400 ease-settle" style={{ width: `${percent}%` }} />
        </span>
      ) : null}
    </div>
  );
}
