import { cn } from "cn";
import { Icon } from "@/components/ui/icons";
import { MatchBadge } from "@/components/ui/marks";

// The design's small drawings, built from boxes like the rest of the UI. All decorative (aria-hidden).

const sketchCard = "absolute box-border h-[116px] w-24 rounded-panel border-2";

/** Stacked cards and a lime check: "You're all caught up". */
export function DeckDoneArt() {
  return (
    <div aria-hidden="true" className="relative size-[150px]">
      <div className={cn(sketchCard, "top-[30px] left-[30px] border-edge bg-surface")} />
      <div className={cn(sketchCard, "top-5 left-[22px] border-edge bg-surface")} />
      <div className={cn(sketchCard, "top-2.5 left-3.5 flex flex-col gap-2 border-edge bg-surface p-3.5 shadow-[0_5px_0_var(--shadow-color)]")}>
        <span className="block size-[26px] rounded-lg bg-inverse" />
        <span className="block h-[7px] w-[90%] rounded-full bg-subtle" />
        <span className="block h-[7px] w-[65%] rounded-full bg-subtle" />
      </div>
      <span className="absolute top-0 right-1 box-border flex size-[52px] items-center justify-center rounded-full border-2 border-ink bg-primary text-ink shadow-[0_4px_0_var(--shadow-color)]">
        <Icon name="check" size={26} strokeWidth={3} />
      </span>
    </div>
  );
}

/** A dashed empty card and a magnifier: "No jobs match these filters". */
export function DeckEmptyArt() {
  return (
    <div aria-hidden="true" className="relative size-[150px]">
      <div className={cn(sketchCard, "top-3.5 left-[22px] border-dashed border-edge bg-transparent")} />
      <span className="absolute right-2 bottom-1.5 box-border flex size-16 items-center justify-center rounded-full border-2 border-edge bg-surface text-foreground shadow-[0_4px_0_var(--shadow-color)]">
        <Icon name="search" size={28} strokeWidth={2.25} />
      </span>
    </div>
  );
}

const fanCard = "absolute box-border h-60 w-[210px] rounded-[24px] border-2 border-edge bg-surface shadow-[0_5px_0_var(--shadow-color)]";

/** Three fanned job cards, the top one stamped APPLY with an 86 match (sign-in). */
export function SignInArt() {
  return (
    <div aria-hidden="true" className="relative h-[290px]">
      <div className={cn(fanCard, "top-[26px] left-[70px] -rotate-11")} />
      <div className={cn(fanCard, "top-[18px] left-20 rotate-6")} />
      <div className={cn(fanCard, "top-[22px] left-[66px] flex -rotate-2 flex-col gap-3.5 p-[18px]")}>
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-[11px] bg-inverse font-display text-[13px] font-extrabold text-inverse-foreground">LP</span>
          <span className="text-[13px] font-semibold">Lumen Pay</span>
        </div>
        <span className="font-display text-[25px] leading-[1.02] font-extrabold tracking-[-0.035em]">Backend Engineer</span>
        <div className="mt-1 flex flex-col gap-[7px]">
          <span className="block h-2 w-full rounded-full bg-sketch-fill" />
          <span className="block h-2 w-[82%] rounded-full bg-sketch-fill" />
          <span className="block h-2 w-[64%] rounded-full bg-sketch-fill" />
        </div>
        <span className="absolute bottom-[22px] left-3.5 -rotate-9 rounded-[10px] border-2 border-ink bg-primary px-3 py-0.5 font-display text-[22px] font-extrabold text-ink">
          APPLY
        </span>
        <MatchBadge score={86} size="md" className="absolute -top-4 -right-3.5" />
      </div>
    </div>
  );
}

/** A page of a resume with a lime band sweeping down while it is read. `band` is the band's step (0-5). */
export function ResumeSketch({ band }: { band: number }) {
  const line = "block h-[5px] rounded-[3px] bg-sketch-line";
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto mt-6 box-border flex h-[172px] w-[136px] flex-col gap-[7px] overflow-hidden rounded-tile border-2 border-edge bg-surface px-3 py-3.5 shadow-hard"
    >
      <span className="block h-[9px] w-[60%] rounded-[3px] bg-foreground" />
      <span className={cn(line, "w-[80%]")} />
      <span className={cn(line, "mt-1.5 w-full")} />
      <span className={cn(line, "w-[92%]")} />
      <span className={cn(line, "w-[70%]")} />
      <span className={cn(line, "mt-1.5 w-full")} />
      <span className={cn(line, "w-[85%]")} />
      <span className={cn(line, "w-[60%]")} />
      <span className={cn(line, "mt-1.5 w-[95%]")} />
      <span className={cn(line, "w-[75%]")} />
      <span
        className="absolute inset-x-0 h-[26px] bg-primary opacity-55 transition-[top] duration-[1100ms] ease-[cubic-bezier(.45,0,.55,1)]"
        style={{ top: 8 + (band % 6) * 26 }}
      />
    </div>
  );
}
