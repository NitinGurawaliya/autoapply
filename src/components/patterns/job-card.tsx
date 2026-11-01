import type { ReactNode } from "react";
import Link from "next/link";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Icon } from "@/components/ui/icons";
import { AccentPill, Tag } from "@/components/ui/chip";
import { BoardMark, CompanyMark, MatchBadge } from "@/components/ui/marks";

/** One height for every card, whatever the job says: the deck keeps its shape from card to card. */
export const CARD_HEIGHT = "h-[clamp(400px,calc(100dvh-340px),470px)]";

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
  score: number;
  tier?: "strong" | "good" | "stretch" | null;
  /** The job board it came from: "Greenhouse", "Lever", "Ashby". */
  board?: string | null;
  logoUrl?: string | null;
  /** First seen in the last 24 hours. */
  isNew?: boolean;
  /** The job's own page in the app (/jobs/[id]). */
  detailHref?: string;
};

/**
 * The swipe card from design/feed.html. Every card has the same frame whatever the job: long names and titles are cut
 * with an ellipsis, and the facts and the board sit on the bottom edge, so the deck never changes shape between cards.
 * The title is two lines at most: at the card's minimum height (400 px, phones under 740 px tall) a three-line title
 * left the reason only two and a half lines, and the half line was cut through the glyphs (1 Nov, Smartsheet).
 * Stamps come from the deck, which animates them.
 */
export function JobCard({ job, stamps }: { job: JobCardData; stamps?: ReactNode }) {
  const why = /[.!?]$/.test(job.why) ? job.why : `${job.why}.`;
  return (
    <>
      <div className="relative box-border flex h-full flex-col overflow-hidden rounded-card border-2 border-edge bg-surface p-[22px] shadow-hard-lg">
        {/* The match badge overlaps the top right corner, so the header stops short of it. */}
        <div className="flex items-center gap-3 pr-[90px]">
          <CompanyMark name={job.company} logoUrl={job.logoUrl} size={48} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-base font-semibold">{job.company}</span>
            <span className="truncate text-sm text-muted-foreground">{job.posted}</span>
          </div>
        </div>
        <h2 className="m-0 mt-5 line-clamp-2 type-display-lg break-words text-balance" title={job.role}>
          {job.role}
        </h2>
        <div className="mt-[18px] flex min-h-0 flex-col gap-1.5">
          <Eyebrow>Why your agent picked it</Eyebrow>
          <p className="m-0 line-clamp-3 type-lead text-pretty">{why}</p>
        </div>
        <div className="mt-auto flex flex-nowrap gap-2 overflow-hidden pt-4">
          {job.isNew ? <AccentPill className="h-[34px] flex-none px-3 text-sm">New</AccentPill> : null}
          <Tag className="min-w-0 shrink">
            <span className="truncate">{job.where}</span>
          </Tag>
          {job.asks ? <Tag className="flex-none whitespace-nowrap">{job.asks}</Tag> : null}
        </div>
        <div className="mt-3.5 flex h-8 items-center justify-between gap-3 border-t-[1.5px] border-line pt-3.5">
          {job.board ? (
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-muted-foreground">
              <BoardMark board={job.board} className="text-foreground" />
              <span className="truncate">via {job.board}</span>
            </span>
          ) : (
            <span />
          )}
          {job.detailHref ? (
            <Link
              href={job.detailHref}
              draggable={false}
              onPointerDown={(event) => event.stopPropagation()}
              // The card itself opens the job on a tap: stop here so the page is not pushed twice.
              onClick={(event) => event.stopPropagation()}
              className="inline-flex min-h-8 flex-none items-center gap-1 text-sm font-semibold text-foreground underline underline-offset-3"
            >
              See details
              <Icon name="chevronRight" size={14} strokeWidth={2.5} />
            </Link>
          ) : null}
        </div>
        {stamps}
      </div>
      <MatchBadge score={job.score} tier={job.tier} className="absolute -top-[18px] right-3.5" />
    </>
  );
}
