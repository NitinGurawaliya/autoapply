import * as React from "react";
import { cn } from "cn";

/** A quiet section label in sentence case: "Why it fits", "Needs you · 2" (Direction B: no letter-spaced capitals). */
export function Eyebrow({ as: Tag = "span", className, ...props }: React.HTMLAttributes<HTMLElement> & { as?: "span" | "h2" | "h3" | "p" }) {
  return <Tag className={cn("m-0 type-meta font-medium text-muted-foreground", className)} {...props} />;
}

/** Loading placeholder in the recessed fill; a slow fade, no shimmer. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-tag bg-sunk", className)} {...props} />;
}
