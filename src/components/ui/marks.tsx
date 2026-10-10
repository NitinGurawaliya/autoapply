import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "cn";
import { Icon } from "@/components/ui/icons";

/** First letters of up to two words: "Lumen Pay" → "LP". */
export function initialsOf(text: string, split: RegExp = /[\s._-]+/) {
  const letters = text
    .split(split)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return letters || "?";
}

const markVariants = cva("box-border inline-flex flex-none items-center justify-center font-display font-extrabold", {
  variants: {
    size: {
      36: "size-9 rounded-[10px] text-[13px]",
      40: "size-10 rounded-tile text-sm",
      44: "size-11 rounded-[13px] text-[15px]",
      48: "size-12 rounded-[14px] text-[17px]",
      56: "size-14 rounded-control text-[19px]",
    },
    tone: {
      inverse: "bg-inverse text-inverse-foreground",
      subtle: "bg-subtle text-foreground",
      outline: "border-[1.5px] border-dash text-muted-foreground",
      accent: "border-[1.5px] border-ink bg-primary text-ink",
    },
  },
  defaultVariants: { size: 48, tone: "inverse" },
});

/** Company initials tile. */
export function CompanyMark({
  name,
  size = 48,
  tone = "inverse",
  className,
}: {
  name: string;
  size?: 36 | 40 | 44 | 48 | 56;
  tone?: "inverse" | "subtle" | "outline" | "accent";
  className?: string;
}) {
  return (
    <span aria-hidden="true" data-company-mark="" className={cn(markVariants({ size, tone }), className)}>
      {initialsOf(name)}
    </span>
  );
}

/** The tilted lime "86 match" badge. */
const TIER_WORD = { strong: "Strong", good: "Good", stretch: "Stretch" } as const;

/** The lime badge: the tier ("Strong match") when given (T82), else the score. */
export function MatchBadge({ score, tier, size = "lg", className }: { score: number; tier?: keyof typeof TIER_WORD | null; size?: "lg" | "md"; className?: string }) {
  const word = tier ? TIER_WORD[tier] : null;
  return (
    <span
      role="img"
      aria-label={word ? `${word} match` : `Match score ${score} percent`}
      className={cn(
        "box-border flex -rotate-8 flex-col items-center justify-center rounded-full border-2 border-ink bg-primary leading-none text-ink",
        size === "lg" ? "size-21 shadow-hard" : "size-[66px] shadow-[0_4px_0_var(--ink)]",
        className,
      )}
    >
      {word ? (
        <span className={cn("font-display font-extrabold tracking-[-0.03em]", size === "lg" ? "text-[19px]" : "text-[15px]")}>{word}</span>
      ) : (
        <span className={cn("font-display font-extrabold tracking-[-0.04em]", size === "lg" ? "text-[32px]" : "text-2xl")}>{score}</span>
      )}
      <span className={cn("mt-0.5 font-bold tracking-[0.06em] uppercase", size === "lg" ? "text-[11px]" : "text-[9px]")}>match</span>
    </span>
  );
}

/** Classes for the APPLY / SKIP stamps (the deck animates their opacity). */
export function stampClass(kind: "apply" | "skip") {
  return cn(
    "pointer-events-none absolute top-[92px] rounded-tile border-2 px-3.5 py-1 font-display text-[28px] font-extrabold",
    kind === "apply" ? "left-[18px] -rotate-8 border-ink bg-primary text-ink" : "right-[18px] rotate-8 border-edge bg-surface text-foreground",
  );
}

/** Ink check or "!" in a circle: sent rows, the detail status pill. */
export function StatusMark({ kind, size = 26 }: { kind: "ok" | "stop"; size?: 22 | 26 }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex flex-none items-center justify-center rounded-full bg-inverse text-inverse-foreground",
        size === 26 ? "size-[26px]" : "size-[22px]",
      )}
    >
      {kind === "ok" ? (
        <Icon name="check" size={size === 26 ? 14 : 12} strokeWidth={size === 26 ? 3 : 3.5} />
      ) : (
        <span className="text-[13px] font-extrabold">!</span>
      )}
    </span>
  );
}

/** Status line under the detail title: "✓ Sent today, 10:42". */
export function StatusPill({ kind, children }: { kind: "ok" | "stop"; children: React.ReactNode }) {
  return (
    <span className="box-border inline-flex h-[34px] items-center gap-2 self-start rounded-full bg-subtle pr-3 pl-1.5 text-sm font-semibold">
      <StatusMark kind={kind} size={22} />
      {children}
    </span>
  );
}

/** The user's initials in the round profile button. */
export function userInitials(name: string | null, email: string) {
  return initialsOf(name || email, /[\s@._-]+/);
}
