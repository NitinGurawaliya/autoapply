import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "cn";
import { Icon } from "@/components/ui/icons";

// Chips (Direction B, Phase O3). Only things the user toggles are pills; a selected one turns ink, never the accent
// (the accent means "act here"). Facts and tags are small rounded rectangles in the recessed fill.
const chipVariants = cva(
  "box-border inline-flex cursor-pointer items-center gap-1 border font-medium no-underline transition-[transform,background-color,color] duration-120 ease-calm outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-98",
  {
    variants: {
      shape: {
        // Filters, notice period, job type, places.
        pill: "h-10 rounded-full px-4 type-body",
        // Applications list: "Sent 18".
        tab: "h-9 flex-none rounded-full px-3.5 type-meta whitespace-nowrap",
        // Two-up choices inside a card (visa sponsorship).
        block: "h-11 justify-center rounded-control type-body",
        // Answer buttons in the needs-you sheet; a long option wraps and the button grows (24 Oct).
        answer: "min-h-12 justify-center rounded-control px-4 py-3 text-center type-body text-balance",
      },
      selected: { true: "", false: "" },
    },
    compoundVariants: [
      { shape: ["pill", "block", "tab", "answer"], selected: false, className: "border-line-strong bg-surface text-foreground active:bg-sunk" },
      { shape: ["pill", "block", "tab", "answer"], selected: true, className: "border-inverse bg-inverse text-inverse-foreground" },
    ],
    defaultVariants: { shape: "pill", selected: false },
  },
);

type ChipShape = "pill" | "tab" | "block" | "answer";
type ChipBase = { selected?: boolean; shape?: ChipShape; count?: number; children: React.ReactNode; className?: string };

/** A selectable chip. With `href` it is a link (the feed filters reload the page), otherwise a toggle button. */
export function Chip(props: ChipBase & ({ href: string } & Omit<React.ComponentProps<"a">, "children">) | ChipBase & ({ href?: undefined } & Omit<React.ComponentProps<"button">, "children">)) {
  const { selected = false, shape = "pill", count, children, className, ...rest } = props;
  const classes = cn(chipVariants({ shape, selected }), className);
  const inner = (
    <>
      {children}
      {count !== undefined ? <span className="tabular-nums opacity-70">{count}</span> : null}
    </>
  );
  if ("href" in rest && rest.href !== undefined) {
    return (
      <a aria-current={selected ? "true" : undefined} className={classes} {...(rest as React.ComponentProps<"a">)}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" aria-pressed={selected} className={classes} {...(rest as React.ComponentProps<"button">)}>
      {inner}
    </button>
  );
}

/** A filter you can remove (the "No matches" state): a toggle, so a pill, with an ×. */
export function RemovableChip({ children, className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line-strong bg-surface pr-2.5 pl-3.5 type-meta font-medium text-foreground transition-transform duration-120 ease-calm active:scale-98",
        className,
      )}
      {...props}
    >
      {children}
      <Icon name="closeSmall" size={14} />
    </button>
  );
}

const tag = "inline-flex h-7 items-center gap-1 rounded-tag bg-sunk px-2.5 type-meta font-medium whitespace-nowrap";

/** A fact: "Bengaluru · Hybrid", "Asks 2–4 yrs". */
export function Tag({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn(tag, className)} {...props} />;
}

/** A quiet fact: "19 sent today". */
export function SoftChip({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn(tag, "text-muted-foreground", className)} {...props} />;
}

/** A skill on the profile screen. */
export function SkillTag({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn(tag, className)} {...props} />;
}

/** "Needs you · 1 of 2": the one status that asks for the user, in ink (the accent is kept for the main action). */
export function AccentPill({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn(tag, "bg-inverse font-semibold text-inverse-foreground", className)} {...props} />;
}

/** Count of answers per source on the detail page: "Resume 5". */
export function CountChip({ label, count, dashed = false, className }: { label: string; count: number; dashed?: boolean; className?: string }) {
  return (
    <span className={cn("box-border inline-flex h-7 items-center gap-1.5 rounded-tag border border-line-strong px-2.5 type-meta font-medium", dashed && "border-dashed", className)}>
      {label} <span className="text-muted-foreground tabular-nums">{count}</span>
    </span>
  );
}

export { chipVariants };
