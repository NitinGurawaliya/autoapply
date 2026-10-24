import type { ReactNode } from "react";
import { cn } from "cn";
import { Icon } from "@/components/ui/icons";
import { Eyebrow } from "@/components/ui/eyebrow";
import { CountChip } from "@/components/ui/chip";
import { SOURCES } from "@/components/ui/source-badge";

/** A white card with an uppercase heading and an optional action ("BASICS · From your resume", "SKILLS · 12  Edit"). */
export function SectionCard({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("box-border rounded-panel border-[1.5px] border-line bg-surface px-4 pt-1.5 pb-2", className)}>
      <div className="flex h-10 items-center justify-between">
        <Eyebrow as="h2">{title}</Eyebrow>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A row in a section card: small label over a bold value, or a bold value over a small line. */
export function Row({
  label,
  value,
  order = "label-first",
  action,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  order?: "label-first" | "value-first";
  action?: ReactNode;
  className?: string;
}) {
  const small = <span className="text-[13px] text-muted-foreground">{label}</span>;
  const big = <span className="text-base font-semibold break-words">{value}</span>;
  return (
    <div className={cn("flex items-center gap-2 border-t border-line", order === "label-first" ? "min-h-14" : "min-h-[60px]", className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
        {order === "label-first" ? (
          <>
            {small}
            {big}
          </>
        ) : (
          <>
            {big}
            {small}
          </>
        )}
      </div>
      {action}
    </div>
  );
}

/** Lock and a sentence: "Private to you. Used only for jobs you swipe right on." */
export function InfoNote({ children, size = "md", className }: { children: ReactNode; size?: "md" | "sm"; className?: string }) {
  return (
    <p className={cn("m-0 flex items-center text-muted-foreground", size === "md" ? "gap-2.5 text-sm leading-[1.4]" : "gap-2 text-[13px]", className)}>
      <Icon name="lock" size={size === "md" ? 18 : 16} className="flex-none" />
      <span>{children}</span>
    </p>
  );
}

/** Filled panel with a round lock: "We never guess these…". */
export function Callout({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-3 rounded-[18px] bg-subtle px-4 py-3.5", className)}>
      <span aria-hidden="true" className="flex size-8 flex-none items-center justify-center rounded-full bg-inverse text-inverse-foreground">
        <Icon name="lock" size={16} strokeWidth={2.25} />
      </span>
      <p className="m-0 text-sm leading-normal">{children}</p>
    </div>
  );
}

/** "Where your answers came from" with how many came from each source. */
export function TrustPanel({ text, counts, className }: { text: ReactNode; counts: Array<{ source: string; count: number }>; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2.5 rounded-panel bg-subtle p-4", className)}>
      <h2 className="m-0 text-lg font-semibold tracking-[-0.01em]">Where your answers came from</h2>
      <p className="m-0 text-sm leading-normal">{text}</p>
      {counts.length ? (
        <div className="mt-0.5 flex flex-wrap gap-1.5">
          {counts.map((count) => (
            <CountChip key={count.source} label={SOURCES[count.source]?.label ?? count.source} count={count.count} dashed={!!SOURCES[count.source]?.dashed} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** Drawing, title, line, optional chips and actions: "You're all caught up", "No jobs match these filters". */
export function EmptyState({
  art,
  title,
  text,
  extra,
  actions,
  headingLevel = "h1",
  className,
}: {
  art: ReactNode;
  title: ReactNode;
  text: ReactNode;
  extra?: ReactNode;
  actions?: ReactNode;
  headingLevel?: "h1" | "h2";
  className?: string;
}) {
  const Heading = headingLevel;
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col items-center justify-center px-7 pb-4 text-center", className)}>
      {art}
      <Heading className="m-0 mt-6 type-display-md">{title}</Heading>
      <p className="m-0 mt-2.5 text-base leading-normal text-pretty text-muted-foreground">{text}</p>
      {extra ? <div className="mt-[18px] flex flex-wrap justify-center gap-2">{extra}</div> : null}
      {actions ? <div className="mt-7 flex w-full flex-col gap-2.5">{actions}</div> : null}
    </div>
  );
}
