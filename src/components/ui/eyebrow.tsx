import * as React from "react";
import { cn } from "cn";

/** Small uppercase section label: "WHY IT FITS", "NEEDS YOU · 2". */
export function Eyebrow({ as: Tag = "span", className, ...props }: React.HTMLAttributes<HTMLElement> & { as?: "span" | "h2" | "h3" | "p" }) {
  return <Tag className={cn("m-0 type-eyebrow", className)} {...props} />;
}

/** Loading placeholder in the quiet fill. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-panel bg-subtle", className)} {...props} />;
}
