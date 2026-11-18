import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

// Icon buttons (Direction B, Phase O3): 44 px, the control radius, a hairline or nothing; the tap shrinks to 98 %.
const iconButtonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-control p-0 text-foreground transition-[transform,background-color] duration-120 ease-calm outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-98 disabled:pointer-events-none disabled:text-faint",
  {
    variants: {
      variant: {
        ghost: "bg-transparent active:bg-sunk",
        line: "border border-line-strong bg-surface active:bg-sunk",
        subtle: "bg-subtle type-meta font-semibold",
        skip: "border border-line-strong bg-surface active:bg-sunk",
        apply: "bg-primary text-primary-foreground active:bg-brand-press",
      },
      size: {
        md: "size-11",
        skip: "size-14",
        apply: "size-14",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

type IconButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof iconButtonVariants> & { "aria-label": string };

export function IconButton({ className, variant, size, type = "button", ...props }: IconButtonProps) {
  return <button type={type} className={cn(iconButtonVariants({ variant, size }), className)} {...props} />;
}

export { iconButtonVariants };
