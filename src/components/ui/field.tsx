import * as React from "react";
import { cn } from "cn";
import { Icon } from "@/components/ui/icons";

// Form parts (Direction B, Phase O3): 48 px boxes with a hairline that turns ink on focus; labels in the meta size.

export function FieldLabel({
  tone = "strong",
  className,
  ...props
}: React.ComponentProps<"label"> & { tone?: "strong" | "muted" | "small" }) {
  return <label className={cn("type-meta", tone === "strong" ? "font-medium text-foreground" : "text-muted-foreground", className)} {...props} />;
}

type InputBoxProps = React.ComponentProps<"input"> & {
  tone?: "strong" | "soft";
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  boxClassName?: string;
};

const box = "box-border flex border border-line-strong transition-colors duration-120 ease-calm focus-within:border-foreground";

/** An input inside a bordered box, with an optional prefix (₹, +91) and suffix (lakh a year). */
export function InputBox({ tone = "strong", prefix, suffix, boxClassName, className, ...props }: InputBoxProps) {
  return (
    <div className={cn(box, "h-12 items-center gap-2 rounded-field px-3.5", tone === "strong" ? "bg-surface" : "bg-background", boxClassName)}>
      {prefix ? <span className="type-body text-muted-foreground">{prefix}</span> : null}
      <input
        className={cn(
          "min-w-0 flex-1 border-0 bg-transparent font-medium text-inherit tabular-nums outline-none placeholder:font-normal placeholder:text-faint",
          tone === "strong" ? "type-section" : "type-body",
          className,
        )}
        {...props}
      />
      {suffix ? <span className="type-meta text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

/** Native select (native, so phones show their own picker). */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "box-border h-12 rounded-field border border-line-strong bg-background px-3 type-body font-medium text-inherit outline-none transition-colors duration-120 ease-calm focus-visible:border-foreground",
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
        "box-border min-h-28 w-full rounded-field border border-line-strong bg-surface px-3.5 py-3 type-body text-inherit outline-none transition-colors duration-120 ease-calm focus-visible:border-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Inline problem line: "Their form rejected this one". */
export function FieldError({ className, children, ...props }: React.ComponentProps<"p">) {
  return (
    <p role="alert" className={cn("m-0 flex items-center gap-1.5 type-meta font-medium", className)} {...props}>
      <Icon name="info" size={14} className="flex-none" />
      {children}
    </p>
  );
}
