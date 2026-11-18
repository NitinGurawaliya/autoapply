import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "cn";
import { Icon } from "@/components/ui/icons";
import { LogoImage } from "@/components/ui/logo-image";

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

// Company tile (Direction B, Phase O3): one radius, the body face at 600, no outline but a hairline when quiet.
const markVariants = cva("box-border inline-flex flex-none items-center justify-center font-semibold", {
  variants: {
    size: {
      36: "size-9 rounded-tile type-meta",
      40: "size-10 rounded-tile type-meta",
      44: "size-11 rounded-tile type-body",
      48: "size-12 rounded-tile type-body",
      56: "size-14 rounded-control type-section",
    },
    tone: {
      inverse: "bg-inverse text-inverse-foreground",
      subtle: "bg-subtle text-foreground",
      outline: "border border-dash text-muted-foreground",
      accent: "bg-primary text-primary-foreground",
    },
  },
  defaultVariants: { size: 48, tone: "inverse" },
});

/** Company tile: its logo when we have one (Company.logoUrl), over its initials, which show if the logo fails. */
export function CompanyMark({
  name,
  logoUrl,
  size = 48,
  tone = "inverse",
  className,
}: {
  name: string;
  logoUrl?: string | null;
  size?: 36 | 40 | 44 | 48 | 56;
  tone?: "inverse" | "subtle" | "outline" | "accent";
  className?: string;
}) {
  return (
    <span aria-hidden="true" data-company-mark="" className={cn(markVariants({ size, tone }), logoUrl && "relative overflow-hidden", className)}>
      {initialsOf(name)}
      {logoUrl ? <LogoImage src={logoUrl} /> : null}
    </span>
  );
}

// The boards' own icons, from each board's website (1 Nov), served from public/boards.
const BOARD_LOGOS: Record<string, string> = {
  greenhouse: "/boards/greenhouse.png",
  ashby: "/boards/ashby.png",
  keka: "/boards/keka.svg",
  lever: "/boards/lever.png",
  smartrecruiters: "/boards/smartrecruiters.png",
};

/**
 * The job board's mark beside "via Greenhouse": the board's own icon, or for a board without one here (Workday, Zoho
 * Recruit) its first letter in a hairline square. `board` is the label ("Greenhouse") or the id ("greenhouse").
 */
export function BoardMark({ board, className, size = 20 }: { board: string; className?: string; size?: number }) {
  const logo = BOARD_LOGOS[board.toLowerCase().replace(/\s+/g, "")];
  if (logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a tiny static icon; next/image adds nothing here
      <img src={logo} alt="" aria-hidden="true" width={size} height={size} draggable={false} className={cn("flex-none rounded-tag select-none", className)} />
    );
  }
  return (
    <span aria-hidden="true" className={cn("box-border inline-flex size-5 flex-none items-center justify-center rounded-tag border border-line-strong type-meta leading-none font-semibold", className)}>
      {board[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

const TIER_WORD = { strong: "Strong", good: "Good", stretch: "Stretch" } as const;

/** The tier's word ("Strong match"), from the score when no tier is given; never a number. A flat label, not a sticker. */
export function MatchBadge({ score, tier, className }: { score: number; tier?: keyof typeof TIER_WORD | null; size?: "lg" | "md"; className?: string }) {
  const word = TIER_WORD[tier ?? (score >= 75 ? "strong" : score >= 60 ? "good" : "stretch")];
  return <span className={cn("inline-flex h-7 items-center rounded-tag bg-surface px-2.5 type-meta font-semibold shadow-lift", className)}>{word} match</span>;
}

const FIT_WORD = { strong: "Strong fit", good: "Good fit", stretch: "Stretch" } as const;
export type FitTier = keyof typeof FIT_WORD;
export const tierFor = (score: number, tier?: FitTier | null): FitTier => tier ?? (score >= 75 ? "strong" : score >= 60 ? "good" : "stretch");

/** The tier as words beside the score (design/craft-b2.html): weight, not colour, tells them apart. */
export function TierPill({ tier, className }: { tier: FitTier; className?: string }) {
  return (
    <span className={cn("type-meta whitespace-nowrap", tier === "strong" ? "font-semibold text-foreground" : "text-muted-foreground", className)}>
      {FIT_WORD[tier]}
    </span>
  );
}

/** Classes for the Apply / Skip labels that fade in while the card is dragged (the deck animates their opacity). */
export function stampClass(kind: "apply" | "skip") {
  return cn(
    "pointer-events-none absolute top-24 rounded-control px-3 py-1.5 type-section",
    kind === "apply" ? "left-5 bg-primary text-primary-foreground" : "right-5 bg-inverse text-inverse-foreground",
  );
}

/**
 * A check (sent), "!" (didn't go through) or a clock (still under way or waiting for the user) in a circle: sent rows,
 * the detail status line. A check means sent and nothing else (e2e finding 7: "Needs you" showed one).
 */
export function StatusMark({ kind, size = 26 }: { kind: "ok" | "stop" | "wait"; size?: 22 | 26 }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex flex-none items-center justify-center rounded-full bg-inverse text-inverse-foreground", size === 26 ? "size-6" : "size-5")}>
      {kind === "ok" ? (
        <Icon name="check" size={size === 26 ? 14 : 12} />
      ) : kind === "wait" ? (
        <Icon name="clock" size={size === 26 ? 14 : 12} />
      ) : (
        <span className="type-meta leading-none font-semibold">!</span>
      )}
    </span>
  );
}

/** Status line under the detail title: "✓ Sent today, 10:42". */
export function StatusPill({ kind, children }: { kind: "ok" | "stop" | "wait"; children: React.ReactNode }) {
  return (
    <span className="box-border inline-flex h-8 items-center gap-2 self-start rounded-tag bg-sunk pr-3 pl-1.5 type-meta font-medium">
      <StatusMark kind={kind} size={22} />
      {children}
    </span>
  );
}

/** The user's initials in the round profile button. */
export function userInitials(name: string | null, email: string) {
  return initialsOf(name || email, /[\s@._-]+/);
}
