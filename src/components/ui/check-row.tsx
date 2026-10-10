import * as React from "react";
import { cn } from "cn";

/** A checkbox with a title and a hint ("Remember for similar questions"). */
export function CheckRow({
  title,
  hint,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "title"> & { title: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-center gap-3", className)}>
      <input type="checkbox" className="m-0 size-[22px] flex-none accent-ink" {...props} />
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{title}</span>
        {hint ? <span className="text-[13px] text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}
