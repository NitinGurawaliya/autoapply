import type { ReactNode } from "react";
import { cn } from "cn";
import { Chip } from "@/components/ui/chip";

export type ChipOption = { label: string; selected: boolean; href?: string; onSelect?: () => void; key?: string };

/** A labelled set of chips (filters, notice period, places). Links when options carry `href`. */
export function ChipGroup({
  legend,
  options,
  shape = "pill",
  className,
  legendClassName,
}: {
  legend: ReactNode;
  options: ChipOption[];
  shape?: "pill" | "block";
  className?: string;
  legendClassName?: string;
}) {
  return (
    <fieldset className={cn("m-0 border-0 p-0", className)}>
      <legend className={cn("mb-2.5 p-0 text-sm font-semibold", legendClassName)}>{legend}</legend>
      <div className={shape === "block" ? "grid grid-cols-2 gap-2" : "flex flex-wrap gap-2"}>
        {options.map((option) =>
          option.href !== undefined ? (
            <Chip key={option.key ?? option.label} shape={shape} selected={option.selected} href={option.href}>
              {option.label}
            </Chip>
          ) : (
            <Chip key={option.key ?? option.label} shape={shape} selected={option.selected} onClick={option.onSelect}>
              {option.label}
            </Chip>
          ),
        )}
      </div>
    </fieldset>
  );
}
