import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

// Round buttons from the design: 44 px header buttons, the 64 px Skip and 72 px Apply under the deck.
const iconButtonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full p-0 text-foreground outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        ghost: "bg-transparent",
        line: "border-[1.5px] border-line bg-surface",
        subtle: "bg-subtle text-sm font-semibold",
        skip: "border-[1.5px] border-line bg-surface shadow-soft",
        apply: "border-2 border-primary-edge bg-primary text-ink shadow-button",
      },
      size: {
        md: "size-11",
        skip: "size-16",
        apply: "size-18",
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
