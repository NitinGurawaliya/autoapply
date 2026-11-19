import { cn } from "cn";

/** The reasons a left swipe can give (P8), in the row's order; the values are learning.ts SKIP_REASONS. */
export const SKIP_REASON_CHOICES = [
  { value: "not_my_field", label: "Not my field" },
  { value: "too_senior", label: "Too senior" },
  { value: "place", label: "Place" },
  { value: "company", label: "Company" },
  { value: "other", label: "Other" },
] as const;
export type SkipReasonValue = (typeof SKIP_REASON_CHOICES)[number]["value"];

/** A question the feed asks from the user's skips ("Stop showing Data engineering roles?"), as the API sends it. */
export type SkipAsk = { family: string; type: string; title: string; detail: string; yes: string; no: string; done: string };

export type SkipToastStep = { step: "why" } | { step: "noted"; text: string } | { step: "ask"; ask: SkipAsk; busy: boolean };

// One-tap choices on the dark card: pills (the user picks one), a 44 px hit area around a 36 px chip.
const choice =
  "relative box-border inline-flex h-9 flex-none cursor-pointer items-center rounded-control border border-inverse-foreground/30 bg-transparent px-3.5 type-meta font-medium text-inverse-foreground transition-[transform,background-color] duration-120 ease-calm outline-none select-none before:absolute before:inset-x-0 before:-inset-y-1 hover:bg-inverse-foreground/10 focus-visible:ring-2 focus-visible:ring-inverse-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-inverse active:scale-98 disabled:cursor-default disabled:opacity-50";

/**
 * The dark card after a left swipe (P8, docs/relevance/TDD.md 5): "Why skip it?" with one tap for the reason, for 4 s
 * (the deck times it and holds it while a pointer or focus is on it); then "Noted", or the one question the skips now
 * ask, which stays until it is answered or the next swipe replaces it. Same card as the after-swipe toast.
 */
export function SkipReasonToast({
  company,
  state,
  visible,
  onReason,
  onAnswer,
  onHold,
  className,
}: {
  company: string;
  state: SkipToastStep;
  visible: boolean;
  onReason: (reason: SkipReasonValue) => void;
  onAnswer: (yes: boolean) => void;
  /** True while a pointer or keyboard focus is on the card: the deck stops its timer. */
  onHold?: (held: boolean) => void;
  className?: string;
}) {
  return (
    <div
      aria-hidden={!visible}
      data-skip-toast=""
      data-step={state.step}
      onPointerEnter={() => onHold?.(true)}
      onPointerLeave={() => onHold?.(false)}
      onFocus={() => onHold?.(true)}
      onBlur={() => onHold?.(false)}
      className={cn(
        "box-border flex flex-col gap-3 rounded-panel bg-inverse px-3.5 py-3 text-inverse-foreground shadow-float transition-[transform,opacity] duration-380 ease-calm",
        visible ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-4.5 scale-[0.97] opacity-0",
        className,
      )}
    >
      {state.step === "why" ? (
        <>
          <p className="m-0 truncate type-body font-semibold" title={company}>
            Why skip {company}?
          </p>
          <div role="group" aria-label="Why you skipped it" className="flex flex-wrap gap-2">
            {SKIP_REASON_CHOICES.map((item) => (
              <button key={item.value} type="button" tabIndex={visible ? undefined : -1} className={choice} onClick={() => onReason(item.value)}>
                {item.label}
              </button>
            ))}
          </div>
        </>
      ) : state.step === "noted" ? (
        <p role="status" className="m-0 type-body font-semibold">
          {state.text}
        </p>
      ) : (
        <>
          <div role="status" className="flex min-w-0 flex-col gap-px">
            <p className="m-0 type-body font-semibold text-balance">{state.ask.title}</p>
            <p className="m-0 type-meta opacity-75">{state.ask.detail}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={state.busy}
              tabIndex={visible ? undefined : -1}
              className={cn(choice, "border-inverse-foreground bg-inverse-foreground text-inverse hover:bg-inverse-foreground/90")}
              onClick={() => onAnswer(true)}
            >
              {state.ask.yes}
            </button>
            <button type="button" disabled={state.busy} tabIndex={visible ? undefined : -1} className={choice} onClick={() => onAnswer(false)}>
              {state.ask.no}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
