import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "cn";
import { Icon } from "@/components/ui/icons";

// Chips from the design. A selectable chip is lime when on; the applications tabs turn ink when on.
const chipVariants = cva(
  "box-border inline-flex cursor-pointer items-center gap-1 border-2 font-semibold no-underline outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50",
  {
    variants: {
      shape: {
        // Filters, notice period, job type, places.
        pill: "h-11 rounded-full px-4 text-[15px]",
        // Applications list: "Sent 18".
        tab: "h-10 flex-none rounded-full px-3.5 text-sm whitespace-nowrap",
        // Two-up choices inside a card (visa sponsorship).
        block: "h-11 justify-center rounded-tile text-[15px]",
        // Big answer buttons in the needs-you sheet. 56px tall; a long option (24 Oct: Juniper Square's AI-use answers)
        // wraps inside the button and the button grows, instead of spilling over its neighbours.
        answer: "min-h-14 justify-center rounded-control px-4 py-3 text-center text-[17px] leading-snug text-balance",
      },
      selected: { true: "", false: "" },
    },
    compoundVariants: [
      { shape: ["pill", "block"], selected: false, className: "border-input bg-surface text-foreground" },
      { shape: "answer", selected: false, className: "border-edge bg-surface text-foreground" },
      { shape: ["pill", "block", "answer"], selected: true, className: "border-primary-edge bg-primary text-primary-foreground" },
      { shape: "answer", selected: true, className: "shadow-button" },
      { shape: "tab", selected: false, className: "border-input bg-surface text-foreground" },
      { shape: "tab", selected: true, className: "border-inverse bg-inverse text-inverse-foreground" },
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
      {count !== undefined ? <span className="tabular-nums opacity-75">{count}</span> : null}
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

/** "×" chip that removes a filter (the "No matches" state). */
export function RemovableChip({ children, className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border-2 border-edge bg-surface pr-2.5 pl-3.5 text-sm font-semibold text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <Icon name="closeSmall" size={16} strokeWidth={2.5} />
    </button>
  );
}

/** Outlined fact on the swipe card: "Bengaluru · Hybrid", "Asks 2–4 yrs". */
export function Tag({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("inline-flex h-[34px] items-center rounded-full border-2 border-edge px-3 text-sm font-semibold", className)}
      {...props}
    />
  );
}

/** Quiet filled fact: "19 sent today". */
export function SoftChip({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cn("inline-flex h-[34px] items-center rounded-full bg-subtle px-3 text-sm font-semibold", className)} {...props} />
  );
}

/** Skill on the profile screen. */
export function SkillTag({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cn("inline-flex h-[30px] items-center rounded-lg bg-subtle px-2.5 text-[13px] font-medium", className)} {...props} />
  );
}

/** Lime pill: "Needs you · 1 of 2". */
export function AccentPill({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "box-border inline-flex h-[30px] items-center rounded-full border-[1.5px] border-primary-edge bg-primary px-3 text-[13px] font-bold text-primary-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Count of answers per source on the detail page: "Resume 5". */
export function CountChip({ label, count, dashed = false, className }: { label: string; count: number; dashed?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "box-border inline-flex h-[30px] items-center gap-1.5 rounded-full border-[1.5px] border-badge-edge bg-surface px-2.5 text-[13px] font-semibold",
        dashed && "border-dashed",
        className,
      )}
    >
      {label} <span className="text-muted-foreground tabular-nums">{count}</span>
    </span>
  );
}

export { chipVariants };
