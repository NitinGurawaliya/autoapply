import type { ReactNode } from "react";
import { cn } from "cn";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icons";
import { SegmentedProgress } from "@/components/ui/segmented-progress";

// Page structure shared by onboarding and the inner pages (design/onboarding.html).

/** A full-height phone column: the page fills the screen and its footer stays at the bottom. */
export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto box-border flex min-h-dvh w-full max-w-[480px] flex-col bg-background pt-[max(12px,env(safe-area-inset-top))] text-foreground", className)}>
      {children}
    </div>
  );
}

/** Back arrow, three segments and "1 of 3". */
export function StepHeader({ step, onBack, backHref }: { step: 1 | 2 | 3; onBack?: () => void; backHref?: string }) {
  const back = <Icon name="back" size={22} strokeWidth={2.25} />;
  return (
    <header className="flex h-11 flex-none items-center gap-3 pr-4 pl-3">
      {backHref ? (
        <a href={backHref} aria-label="Back" className="flex size-11 flex-none items-center justify-center rounded-full text-foreground">
          {back}
        </a>
      ) : (
        <IconButton aria-label="Back" onClick={onBack} disabled={!onBack} className="disabled:opacity-0">
          {back}
        </IconButton>
      )}
      <SegmentedProgress count={3} done={step} thickness={6} className="flex-1" />
      <span className="text-[13px] font-semibold text-muted-foreground tabular-nums">{step} of 3</span>
    </header>
  );
}

/** The big title and the line under it. */
export function PageIntro({ title, sub, eyebrow, className }: { title: ReactNode; sub?: ReactNode; eyebrow?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col", eyebrow ? "gap-2" : "gap-2.5", className)}>
      {eyebrow ? <span className="text-[13px] font-semibold text-muted-foreground">{eyebrow}</span> : null}
      <h1 className="m-0 type-display-lg">{title}</h1>
      {sub ? <p className="m-0 text-base leading-normal text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/** Scrolling content between a header and a footer. */
export function ScreenBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-h-0 flex-1 flex-col px-6 pt-5 pb-7", className)}>{children}</div>;
}

/** The main action, pinned to the bottom with a hairline above it. */
export function StickyFooter({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 flex-none border-t border-line bg-background px-6 pt-3 pb-[max(28px,env(safe-area-inset-bottom))]">{children}</div>;
}
