"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { cn } from "cn";
import { Icon } from "@/components/ui/icons";
import type { DepartmentId } from "@/lib/department";

// The company page's job cards (design/companies.html, Phase W5): a tile and label in the department's own hue, the
// title, a line of facts, and on the right the person's match when the app has worked it out, then Apply (or what already
// happened). The card nearest the middle of the screen is the active one while scrolling: it lifts, takes a bar in its
// hue, and its button grows to "Apply with agent", so the one the reader is on always shows what Apply does.

const ActiveJob = createContext<string | null>(null);

/** The cards of one list; tells each card whether it is the one nearest the middle of the screen. */
export function JobCards({ children, className }: { children: ReactNode; className?: string }) {
  const list = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const middle = window.innerHeight * 0.45;
      let best: { id: string; distance: number } | null = null;
      for (const card of element.querySelectorAll<HTMLElement>("[data-job-id]")) {
        const box = card.getBoundingClientRect();
        if (box.bottom < 0 || box.top > window.innerHeight) continue;
        const distance = Math.abs(box.top + box.height / 2 - middle);
        if (!best || distance < best.distance) best = { id: card.dataset.jobId ?? "", distance };
      }
      setActive((current) => (best && best.id !== current ? best.id : current));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <ActiveJob.Provider value={active}>
      <ul ref={list} className={cn("m-0 flex list-none flex-col gap-3 p-0", className)}>
        {children}
      </ul>
    </ActiveJob.Provider>
  );
}

const svg = (paths: ReactNode) => (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths}
  </svg>
);

/** A drawing for each department, one stroke weight, in the department's hue. */
export function DepartmentIcon({ id }: { id: DepartmentId }) {
  switch (id) {
    case "engineering":
      return svg(<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />);
    case "data":
      return svg(<path d="M5 20V10M12 20V4M19 20v-7" />);
    case "product":
      return svg(<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM12 12l8-4.5M12 12L4 7.5M12 12v9" />);
    case "design":
      return <Icon name="pen" size={24} />;
    case "sales":
      return <Icon name="target" size={24} />;
    case "marketing":
      return svg(<path d="M4 10v4h3l7 4V6L7 10H4zM17 9a4 4 0 0 1 0 6" />);
    case "finance":
      return svg(<path d="M6 4h12M6 9h12M9 4c5 0 7 2 7 5s-2 5-7 5l7 6" />);
    case "people":
      return <Icon name="person" size={24} />;
    case "operations":
      return svg(
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
        </>,
      );
    default:
      return svg(
        <>
          <rect x="4" y="8" width="16" height="11" rx="2" />
          <path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        </>,
      );
  }
}

/** Apply: held while the action runs (to Google, or to the resume step). Grows to "Apply with agent" on the active card. */
function ApplyButton({ active }: { active: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={cn(
        "flex h-11 w-full items-center justify-center gap-2 rounded-full bg-inverse px-5 type-body font-semibold text-inverse-foreground transition-[box-shadow,transform] duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] disabled:opacity-60 lg:w-auto",
        active && "shadow-lift",
      )}
    >
      <span>{pending ? "Opening…" : "Apply"}</span>
      {pending ? null : (
        <span className={cn("flex items-center gap-2 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out", active ? "max-w-40 opacity-100" : "max-w-0 opacity-0")}>
          with agent
          <Icon name="arrowRight" size={16} />
        </span>
      )}
    </button>
  );
}

/** What already happened to a job for the signed-in person: the application's status, in the app's own words. */
export type JobStatus = { label: string; group: "needs" | "progress" | "sent" | "failed"; href: string };

function StatusLink({ status }: { status: JobStatus }) {
  const base = "flex h-11 w-full items-center justify-center gap-2 rounded-full px-5 type-body font-semibold lg:w-auto";
  if (status.group === "needs") {
    return (
      <Link href={status.href} className={cn(base, "bg-primary text-primary-foreground")}>
        {status.label}
        <Icon name="arrowRight" size={16} />
      </Link>
    );
  }
  if (status.group === "sent") {
    return (
      <Link href={status.href} className={cn(base, "text-foreground ring-1 ring-line-strong active:bg-sunk")}>
        <Icon name="check" size={16} />
        {status.label}
      </Link>
    );
  }
  if (status.group === "progress") {
    return (
      <Link href={status.href} className={cn(base, "text-foreground ring-1 ring-line-strong active:bg-sunk")}>
        <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-foreground" />
        {status.label}
      </Link>
    );
  }
  return (
    <Link href={status.href} className={cn(base, "border border-dashed border-dash text-muted-foreground active:bg-sunk")}>
      {status.label}
    </Link>
  );
}

export type JobCardProps = {
  id: string;
  title: string;
  department: DepartmentId;
  departmentLabel: string;
  isNew: boolean;
  /** Place, experience, how long ago: whichever the posting gives. */
  facts: string[];
  /** The board's own pay field, formatted, or null. */
  salary: string | null;
  /** The job's own page, or null while share pages are off. */
  href: string | null;
  /** Hands the job to Apply (the server action, bound to this job), or null when the agent cannot apply on its board. */
  apply: (() => Promise<void>) | null;
  /** The signed-in person's match, when the app has already worked it out for them. */
  score: number | null;
  /** What already happened to this job for the signed-in person. */
  status: JobStatus | null;
};

export function JobCard({ id, title, department, departmentLabel, isNew, facts, salary, href, apply, score, status }: JobCardProps) {
  const activeId = useContext(ActiveJob);
  const active = activeId === id;
  return (
    <li
      data-job-id={id}
      className={cn(
        `dept-${department} relative rounded-card bg-surface ring-1 ring-line transition-[box-shadow,transform] duration-200 ease-out`,
        active && "shadow-lift ring-line-strong lg:-translate-y-px",
      )}
    >
      <span aria-hidden="true" className={cn("dept-bar absolute top-4 bottom-4 left-0 w-0.75 rounded-r-full transition-opacity duration-200", active ? "opacity-100" : "opacity-0")} />
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:gap-6 lg:p-5">
        <div className="flex min-w-0 flex-1 gap-4">
          <span className="dept-tint flex size-12 flex-none items-center justify-center rounded-control">
            <DepartmentIcon id={department} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="type-label flex items-center gap-2">
              <span className="dept-ink">{departmentLabel}</span>
              {isNew ? <span className="text-brand-text">New</span> : null}
            </span>
            <h3 className="m-0 line-clamp-2 type-section text-balance" title={title}>
              {href ? (
                <Link href={href} className="text-foreground no-underline hover:underline hover:underline-offset-4">
                  {title}
                </Link>
              ) : (
                title
              )}
            </h3>
            <p className="m-0 type-meta text-muted-foreground">
              {facts.join(" · ")}
              {salary ? <span className="ml-2 font-mono text-foreground">{salary}</span> : null}
            </p>
          </div>
        </div>
        <div className="flex flex-none items-center justify-between gap-4 lg:justify-end">
          {score != null && !status ? (
            <span className="flex items-baseline gap-1.5 lg:flex-col lg:items-end lg:gap-0">
              <span className="type-heading text-brand-text tabular-nums">{score}</span>
              <span className="type-meta text-muted-foreground">match</span>
            </span>
          ) : (
            <span className="lg:hidden" />
          )}
          {status ? (
            <StatusLink status={status} />
          ) : apply ? (
            <form action={apply} className="min-w-0 flex-1 lg:flex-none">
              <ApplyButton active={active} />
            </form>
          ) : href ? (
            <Link href={href} className="flex h-11 w-full items-center justify-center rounded-full px-5 type-body font-semibold text-foreground ring-1 ring-line-strong active:bg-sunk lg:w-auto">
              View job
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}
