import * as React from "react";
import { cn } from "cn";
import { Icon } from "@/components/ui/icons";

// Form parts from the design: a strong 56 px input (pay), a soft 52 px input (phone), a native select.

export function FieldLabel({
  tone = "strong",
  className,
  ...props
}: React.ComponentProps<"label"> & { tone?: "strong" | "muted" | "small" }) {
  return (
    <label
      className={cn(
        tone === "strong" && "text-sm font-semibold",
        tone === "muted" && "text-sm text-muted-foreground",
        tone === "small" && "text-[13px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

type InputBoxProps = React.ComponentProps<"input"> & {
  tone?: "strong" | "soft";
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  boxClassName?: string;
};

/** An input inside a bordered box, with an optional prefix (₹, +91) and suffix (lakh a year). */
export function InputBox({ tone = "strong", prefix, suffix, boxClassName, className, ...props }: InputBoxProps) {
  return (
    <div
      className={cn(
        "box-border flex items-center border-2 focus-within:ring-3 focus-within:ring-ring/50",
        tone === "strong" ? "h-14 gap-2.5 rounded-field border-edge bg-surface px-4" : "h-13 gap-2.5 rounded-field border-input bg-background px-3.5",
        boxClassName,
      )}
    >
      {prefix ? <span className={cn("text-muted-foreground", tone === "strong" ? "text-[17px]" : "text-base")}>{prefix}</span> : null}
      <input
        className={cn(
          "min-w-0 flex-1 border-0 bg-transparent font-semibold text-inherit outline-none placeholder:font-normal placeholder:text-muted-foreground",
          tone === "strong" ? "text-lg" : "text-base",
          className,
        )}
        {...props}
      />
      {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

/** Native select in the design's style (native, so phones show their own picker). */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "box-border h-12 rounded-tile border-2 border-input bg-background px-3 text-[15px] font-semibold text-inherit outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}

/** A multi-line answer in the same box style. */
export function TextAreaBox({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "box-border min-h-28 w-full rounded-field border-2 border-edge bg-surface px-4 py-3 text-base leading-normal font-medium text-inherit outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}

/** Inline problem line, in the design's "Their form rejected this one" style. */
export function FieldError({ className, children, ...props }: React.ComponentProps<"p">) {
  return (
    <p role="alert" className={cn("m-0 flex items-center gap-1.5 text-[13px] font-semibold", className)} {...props}>
      <Icon name="info" size={14} strokeWidth={2.25} className="flex-none" />
      {children}
    </p>
  );
}
