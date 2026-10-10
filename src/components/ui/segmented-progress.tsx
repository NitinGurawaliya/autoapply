import { cn } from "cn";

/**
 * Segments lit up to `done` (onboarding steps, the four application stages). `toast` uses the colours that sit on the
 * dark after-swipe card.
 */
export function SegmentedProgress({
  count,
  done,
  tone = "default",
  thickness = 5,
  className,
}: {
  count: number;
  done: number;
  tone?: "default" | "toast";
  thickness?: 4 | 5 | 6;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("grid gap-1", thickness === 6 && "gap-1.5", className)}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: count }, (_, index) => {
        const lit = index < done;
        return (
          <span
            key={index}
            data-lit={lit ? "" : undefined}
            className={cn(
              "block rounded-full transition-colors duration-300",
              thickness === 4 ? "h-1" : thickness === 5 ? "h-[5px]" : "h-1.5",
              tone === "toast" ? (lit ? "bg-toast-seg-on" : "bg-toast-seg-off") : lit ? "bg-bar" : "bg-track",
            )}
          />
        );
      })}
    </div>
  );
}

/** A thin bar (daily usage, reading the resume). `value` is 0 to 100. */
export function ProgressBar({ value, thickness = 6, className }: { value: number; thickness?: 4 | 6; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("block overflow-hidden rounded-full bg-track", thickness === 4 ? "h-1" : "h-1.5", className)}>
      <span
        className="block h-full rounded-full bg-bar transition-[width] duration-[900ms] ease-settle"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </span>
  );
}
