import type { ReactNode } from "react";
import { cn } from "cn";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Icon } from "@/components/ui/icons";
import { SourceBadge, SOURCES } from "@/components/ui/source-badge";

// The parts of the application detail page (design/detail.html).

/** "What happened / What you can do": the card for anything not sent. */
export function FailureCard({
  eyebrow = "What happened",
  headline,
  text,
  actions,
  note,
}: {
  eyebrow?: string;
  headline: string;
  text?: string | null;
  actions?: ReactNode;
  note?: string;
}) {
  return (
    <section
      aria-label="Where this stands"
      className="mt-6 box-border flex flex-col gap-2.5 rounded-[22px] border-2 border-edge bg-surface p-[18px] shadow-[0_5px_0_var(--shadow-color)]"
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="m-0 text-xl leading-[1.25] font-semibold tracking-[-0.01em]">{headline}</h2>
      {text ? <p className="m-0 text-[15px] leading-normal">{text}</p> : null}
      {actions ? (
        <>
          <Eyebrow className="mt-1.5">What you can do</Eyebrow>
          {actions}
        </>
      ) : null}
      {note ? <p className="m-0 text-[13px] leading-[1.45] text-muted-foreground">{note}</p> : null}
    </section>
  );
}

export type StoryStep = {
  key: string;
  time: string;
  title: string;
  sub?: string | null;
  state: "done" | "current" | "stopped" | "todo" | "end";
};

/** "The story": time, a node on a line, and what happened. */
export function Timeline({ steps }: { steps: StoryStep[] }) {
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li key={step.key} data-step={step.state} className="grid min-h-[62px] grid-cols-[48px_24px_minmax(0,1fr)] gap-x-2.5">
            <span className="pt-0.5 text-[13px] text-muted-foreground tabular-nums">{step.time}</span>
            <span aria-hidden="true" className="relative flex justify-center">
              {!last ? <span className="absolute top-[18px] -bottom-0.5 w-0.5 bg-line" /> : null}
              <span
                className={cn(
                  "relative mt-px box-border flex size-[18px] items-center justify-center rounded-full border-2 text-[11px] font-extrabold",
                  step.state === "done" && "border-foreground bg-foreground",
                  step.state === "end" && "border-primary-edge bg-primary text-ink",
                  step.state === "stopped" && "border-foreground bg-background text-foreground",
                  step.state === "current" && "animate-pulse border-foreground bg-primary",
                  step.state === "todo" && "border-line-strong bg-background",
                )}
              >
                {step.state === "end" ? <Icon name="check" size={10} strokeWidth={4} /> : step.state === "stopped" ? "!" : null}
              </span>
            </span>
            <span className="flex flex-col gap-0.5 pb-4">
              <span data-step-title="" className={cn("text-[15px] font-semibold", step.state === "todo" && "text-muted-foreground")}>
                {step.title}
              </span>
              {step.sub ? <span className="text-[13px] leading-[1.45] break-words text-muted-foreground">{step.sub}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export type FilledValue = { key: string; label: string; value: string; source: string; basis?: string };

/** Every filled value with where it came from. AI drafts sit in a dashed box. */
export function FieldList({ groups }: { groups: Array<{ name: string; fields: FilledValue[] }> }) {
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.name} className="flex flex-col">
          <Eyebrow as="h3" className="mt-1 text-[11px]">
            {group.name}
          </Eyebrow>
          <dl className="m-0 flex flex-col">
            {group.fields.map((field, index) => {
              const draft = SOURCES[field.source]?.dashed;
              return (
                <div key={`${field.key}-${index}`} className="flex flex-col gap-2 border-b border-line py-3">
                  <div className="flex items-start gap-2.5">
                    <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                      <dt className="text-[13px] text-muted-foreground">{field.label}</dt>
                      {!draft ? <dd className="m-0 text-base font-semibold break-words">{field.value || "—"}</dd> : null}
                    </div>
                    <SourceBadge source={field.source} />
                  </div>
                  {draft ? (
                    <dd className="m-0 rounded-field border-[1.5px] border-dashed border-draft-dash px-3.5 py-3 text-[15px] leading-normal break-words whitespace-pre-wrap">
                      {field.value || "—"}
                    </dd>
                  ) : null}
                  {field.basis ? <span className="text-[13px] text-muted-foreground">Why: {field.basis}</span> : null}
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </div>
  );
}

/** The screenshot in a light browser frame, with the page address. */
export function ScreenshotFrame({ src, alt, address }: { src: string; alt: string; address: string }) {
  return (
    <figure className="m-0 overflow-hidden rounded-[18px] border-2 border-edge bg-frame shadow-hard">
      <div className="flex h-[34px] items-center gap-2 border-b border-frame-line bg-frame-bar px-3">
        <span className="size-2 rounded-full bg-frame-dot" />
        <span className="size-2 rounded-full bg-frame-dot" />
        <span className="flex h-5 min-w-0 flex-1 items-center truncate rounded-md bg-frame px-2 text-[11px] text-frame-text">{address}</span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" className="block w-full" />
    </figure>
  );
}
