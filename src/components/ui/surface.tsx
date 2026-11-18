import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

// Containers (Direction B, Phase O3): raised (one soft lift), quiet (a hairline), dashed (didn't go through), subtle
// fill. The variant names stay so screens keep working; "outline" is the dashed edge for a missing field.
const surfaceVariants = cva("box-border", {
  variants: {
    variant: {
      raised: "bg-surface shadow-lift",
      quiet: "border border-line bg-surface",
      dashed: "border border-dashed border-dash bg-transparent",
      outline: "border border-dashed border-line-strong bg-surface",
      subtle: "bg-subtle",
    },
    radius: {
      card: "rounded-card",
      large: "rounded-card",
      panel: "rounded-panel",
      row: "rounded-panel",
      control: "rounded-control",
    },
  },
  defaultVariants: { variant: "quiet", radius: "panel" },
});

type SurfaceProps = React.HTMLAttributes<HTMLElement> & VariantProps<typeof surfaceVariants> & { as?: "div" | "section" | "article" | "li" };

export function Surface({ as: Tag = "div", variant, radius, className, ...props }: SurfaceProps) {
  return <Tag className={cn(surfaceVariants({ variant, radius }), className)} {...props} />;
}

export { surfaceVariants };
