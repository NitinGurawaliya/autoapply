import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Icon } from "@/components/ui/icons";
import { Tag } from "@/components/ui/chip";
import { CompanyMark, MatchBadge } from "@/components/ui/marks";

export type JobCardData = {
  company: string;
  role: string;
  /** "Posted 3h ago", "Posted today". */
  posted: string;
  why: string;
  /** "Bengaluru · Hybrid". */
  where: string;
  /** "Asks 2+ yrs", "Entry level"; null when the posting does not say. */
  asks: string | null;
  hint?: string | null;
  score: number;
  applyUrl?: string;
};

/** The swipe card from design/feed.html. Stamps come from the deck, which animates them. */
export function JobCard({ job, stamps }: { job: JobCardData; stamps?: ReactNode }) {
  return (
    <>
      <div className="relative box-border flex h-full flex-col rounded-card border-2 border-edge bg-surface p-[22px] shadow-hard-lg">
        <div className="flex items-center gap-3">
          <CompanyMark name={job.company} size={48} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-base font-semibold">{job.company}</span>
            <span className="text-sm text-muted-foreground">{job.posted}</span>
          </div>
        </div>
        <h2 className="m-0 mt-6 max-w-[290px] type-display-xl text-balance">{job.role}</h2>
        <div className="mt-[22px] flex flex-col gap-1.5">
          <Eyebrow>Why it fits</Eyebrow>
          <p className="m-0 type-lead text-pretty">{job.why}</p>
        </div>
        <div className="mt-[18px] flex flex-wrap gap-2">
          <Tag>{job.where}</Tag>
          {job.asks ? <Tag>{job.asks}</Tag> : null}
          {job.hint ? (
            <Tag className="gap-1.5">
              <Icon name="info" size={14} strokeWidth={2.25} />
              {job.hint}
            </Tag>
          ) : null}
        </div>
        {job.applyUrl ? (
          <a
            href={job.applyUrl}
            target="_blank"
            rel="noreferrer"
            onPointerDown={(event) => event.stopPropagation()}
            className="mt-3.5 inline-flex min-h-8 items-center gap-1.5 self-start text-sm font-semibold text-foreground underline underline-offset-3"
          >
            View job
            <Icon name="external" size={14} />
          </a>
        ) : null}
        {stamps}
      </div>
      <MatchBadge score={job.score} className="absolute -top-[18px] right-3.5" />
    </>
  );
}
