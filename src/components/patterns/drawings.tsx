import { cn } from "cn";
import { Icon } from "@/components/ui/icons";

// Small drawings (Direction B, Phase O4; owner 18 Nov: a drawing only on onboarding and "all caught up", a quiet icon
// everywhere else). Built from the same tokens as the UI, flat, no tilt, no stickers. All decorative (aria-hidden).

const bone = "block rounded-xs bg-sunk";

/** Two quiet cards and an ink check: "You're all caught up". */
export function DeckDoneArt() {
  return (
    <div aria-hidden="true" className="relative h-32 w-36">
      <div className="absolute top-6 left-9 h-26 w-22 scale-95 rounded-panel bg-surface opacity-60 shadow-lift" />
      <div className="absolute top-3 left-5 flex h-26 w-22 flex-col gap-2 rounded-panel bg-surface p-3 shadow-lift">
        <span className="block size-6 rounded-tag bg-inverse" />
        <span className={cn(bone, "mt-1 h-1.5 w-full")} />
        <span className={cn(bone, "h-1.5 w-3/4")} />
        <span className={cn(bone, "h-1.5 w-1/2")} />
      </div>
      <span className="absolute top-0 right-4 flex size-10 items-center justify-center rounded-full bg-inverse text-inverse-foreground">
        <Icon name="check" size={20} />
      </span>
    </div>
  );
}

/** The quiet mark for every other empty or error state: one icon in the recessed fill. */
export function DeckEmptyArt({ icon = "search" }: { icon?: "search" | "info" | "file" }) {
  return (
    <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-control bg-sunk text-muted-foreground">
      <Icon name={icon} size={22} />
    </span>
  );
}

/** One job card as the feed draws it, with the next one behind (sign-in). */
export function SignInArt() {
  return (
    <div aria-hidden="true" className="relative mx-auto h-52 w-64">
      <div className="absolute inset-x-0 top-3 h-44 scale-95 rounded-card bg-surface opacity-60 shadow-lift" />
      <div className="absolute inset-x-0 top-0 flex h-44 flex-col rounded-card bg-surface p-5 shadow-lift">
        <div className="flex items-start gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-tile bg-inverse type-meta font-semibold text-inverse-foreground">LP</span>
          <span className="flex flex-1 flex-col">
            <span className="type-meta font-semibold">Lumen Pay</span>
            <span className="text-xs text-muted-foreground">via Greenhouse</span>
          </span>
          <span className="type-heading font-medium text-brand-text tabular-nums">86</span>
        </div>
        <span className="mt-4 type-section">Backend Engineer</span>
        <span className="mt-1 type-meta text-muted-foreground">Bengaluru · 0–2 years</span>
        <div className="mt-auto flex h-1 gap-1">
          <span className="relative flex-[5] overflow-hidden rounded-xs bg-track"><span className="absolute inset-y-0 left-0 w-4/5 bg-bar" /></span>
          <span className="relative flex-[4] overflow-hidden rounded-xs bg-track"><span className="absolute inset-y-0 left-0 w-11/12 bg-bar" /></span>
          <span className="relative flex-1 overflow-hidden rounded-xs bg-bar" />
        </div>
      </div>
    </div>
  );
}

/** A page of a resume with a soft band moving down while it is read (onboarding). `band` is the band's step (0-5). */
export function ResumeSketch({ band }: { band: number }) {
  const line = "block h-1.25 rounded-xs bg-sketch-line";
  return (
    <div aria-hidden="true" className="relative mx-auto mt-6 flex h-43 w-34 flex-col gap-1.75 overflow-hidden rounded-tile bg-surface px-3 py-3.5 shadow-lift">
      <span className="block h-2.25 w-3/5 rounded-xs bg-foreground" />
      <span className={cn(line, "w-4/5")} />
      <span className={cn(line, "mt-1.5 w-full")} />
      <span className={cn(line, "w-11/12")} />
      <span className={cn(line, "w-7/10")} />
      <span className={cn(line, "mt-1.5 w-full")} />
      <span className={cn(line, "w-5/6")} />
      <span className={cn(line, "w-3/5")} />
      <span className={cn(line, "mt-1.5 w-11/12")} />
      <span className={cn(line, "w-3/4")} />
      <span className="absolute inset-x-0 h-6.5 bg-bar opacity-8 transition-[top] duration-1100 ease-calm" style={{ top: 8 + (band % 6) * 26 }} />
    </div>
  );
}
