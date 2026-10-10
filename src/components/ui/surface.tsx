import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

// The design's containers: raised (ink edge + hard shadow), quiet (hairline), dashed (didn't go through), subtle fill.
const surfaceVariants = cva("box-border", {
  variants: {
    variant: {
      raised: "border-2 border-edge bg-surface shadow-hard",
      quiet: "border-[1.5px] border-line bg-surface",
      dashed: "border-[1.5px] border-dashed border-dash bg-transparent",
      outline: "border-2 border-dashed border-edge bg-surface",
      subtle: "bg-subtle",
    },
    radius: {
      card: "rounded-card",
      large: "rounded-[22px]",
      panel: "rounded-panel",
      row: "rounded-[18px]",
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
