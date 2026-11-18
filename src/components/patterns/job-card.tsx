import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "cn";
import { CompanyMark, type FitTier } from "@/components/ui/marks";

/** One height for every card, whatever the job says: the deck keeps its shape from card to card (Phase M6). */
export const CARD_HEIGHT = "h-[clamp(440px,calc(100dvh-330px),490px)]";

export type JobCardData = {
  company: string;
  role: string;
  /** "Posted 3 days ago", "Posted today". */
  posted: string;
  why: string;
  /** "Bengaluru · On-site". */
  where: string;
  /** "Fresher", "2+ yrs", "2+ yrs · you have 1" (`over`: asks more than the candidate has), "Years not stated". */
  experience: { label: string; over: boolean };
  /** As the board published it ("₹15L – ₹30L"); null when it gives none. */
  salary?: string | null;
  /** "Startup", "Mid-size", "MNC" (shown on the job page; the card keeps three facts). */
  stage?: string | null;
  /**
   * The job's tech skills the candidate has, and the ones missing: `missing` is the required ones when `split`, every
   * one otherwise; `mentioned` is the rest the candidate does not show (nice to have).
   */
  skills?: { have: string[]; missing: string[]; split: boolean; total: number; mentioned?: string[] };
  score: number;
  tier?: FitTier | null;
  /** The score's parts (work, skills, experience), drawn as one split bar under the facts. */
  parts?: Array<{ label: string; points: number; max: number }>;
  /** The job board it came from: "Greenhouse", "Lever", "Ashby". */
  board?: string | null;
  logoUrl?: string | null;
  /** First seen in the last 24 hours. */
  isNew?: boolean;
  /** The job's own page in the app (/jobs/[id]). */
  detailHref?: string;
};

// A skill line's room at 390 px: the card's 310 px of content less the widest label ("Not on resume", 102 px) and its
// 12 px gap. The labels share one grid column sized to the longest (e2e finding 1, 18 Nov: a fixed 72 px column let
// "Not on resume" run into the skills).
const LINE_PX = 196;
const CHAR_PX = 7.7; // 15 px Schibsted Grotesk, a little over its average glyph
const SEP_PX = 8; // ", "
const MORE_PX = 28; // " +n"

/** As many names as fit one line (estimated, so nothing is cut mid-word), and how many are left for "+n". */
function fitLine(items: string[], most = 4) {
  const shown: string[] = [];
  let used = 0;
  for (const [i, item] of items.entries()) {
    const width = CHAR_PX * item.length + (shown.length > 0 ? SEP_PX : 0);
    const reserve = i < items.length - 1 ? MORE_PX : 0;
    if (shown.length >= most || (shown.length > 0 && used + width + reserve > LINE_PX)) break;
    shown.push(item);
    used += width;
  }
  return { shown, more: items.length - shown.length };
}

/** One label and its list, as two cells of the skills grid (the parent sets the columns). */
function SkillLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="type-body whitespace-nowrap text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate type-body whitespace-nowrap">{children}</span>
    </>
  );
}

/** The card while jobs load: its own shape in the recessed fill, a slow fade, no shimmer (design/craft-b2.html). */
export function JobCardSkeleton({ className }: { className?: string }) {
  const bone = "animate-pulse rounded-tag bg-sunk";
  return (
    <div aria-hidden="true" className={cn("box-border flex flex-col rounded-card bg-surface p-6 shadow-lift", CARD_HEIGHT, className)}>
      <div className="flex items-start gap-3">
        <span className={cn(bone, "size-10 rounded-tile")} />
        <span className="flex flex-1 flex-col gap-2 pt-1">
          <span className={cn(bone, "h-3.5 w-24")} />
          <span className={cn(bone, "h-3 w-16")} />
        </span>
        <span className={cn(bone, "h-10 w-14")} />
      </div>
      <span className={cn(bone, "mt-7 h-6 w-11/12")} />
      <span className={cn(bone, "mt-2 h-6 w-1/2")} />
      <span className={cn(bone, "mt-4 h-3 w-28")} />
      <span className={cn(bone, "mt-5 h-3.5 w-36")} />
      <span className={cn(bone, "mt-2 h-3.5 w-48")} />
      <span className={cn(bone, "mt-5 h-1 w-full")} />
      <span className={cn(bone, "mt-auto h-3.5 w-4/5")} />
      <span className={cn(bone, "mt-3 h-3.5 w-3/5")} />
    </div>
  );
}

/** "+2" after a cut list. */
const More = ({ n }: { n: number }) => (n > 0 ? <span className="type-meta text-muted-foreground tabular-nums"> +{n}</span> : null);

/**
 * The swipe card (design/craft-b2.html, Phase O4): the score large and light in the accent, the role, the place on its
 * own line with years and pay under it, the score's parts as one split bar, the job's skills against the candidate's
 * as plain text, and one reason. Meaning by form: a required skill the candidate lacks is underlined dashed, a
 * nice-to-have one is grey. Every card keeps the same frame: names and titles are cut, a skill line ends in "+n".
 * Stamps come from the deck, which animates them.
 */
export function JobCard({ job, stamps }: { job: JobCardData; stamps?: ReactNode }) {
  const why = /[.!?]$/.test(job.why) ? job.why : `${job.why}.`;
  const skills = job.skills && job.skills.total > 0 ? job.skills : null;
  const have = skills ? fitLine(skills.have) : null;
  // Required gaps first, then the nice-to-have ones: the card never says nothing is missing while the job names tech
  // the candidate does not show.
  const missing = skills ? fitLine([...skills.missing, ...(skills.mentioned ?? [])], 3) : null;
  const required = new Set(skills?.missing ?? []);
  const missingLabel = skills?.split && skills.missing.length > 0 ? "Missing" : "Not on resume";
  const second = [job.experience.label, job.salary].filter(Boolean);
  return (
    <div className="relative box-border flex h-full flex-col overflow-hidden rounded-card bg-surface p-6 shadow-lift">
      <div className="flex items-start gap-3">
        <CompanyMark name={job.company} logoUrl={job.logoUrl} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate type-body font-semibold">{job.company}</span>
          {job.board ? <span className="truncate type-meta text-muted-foreground">via {job.board}</span> : null}
        </div>
        <div className="flex flex-none flex-col items-end" aria-label={`${job.score} match`}>
          <span className="type-score text-brand-text">{job.score}</span>
          <span className="mt-1.5 type-meta text-muted-foreground">match</span>
        </div>
      </div>

      <h2 className="m-0 mt-6 line-clamp-2 type-heading break-words" title={job.role}>
        {job.role}
      </h2>
      <p className="m-0 mt-2 flex items-center gap-2 type-meta text-muted-foreground">
        {job.posted}
        {job.isNew ? <span className="font-semibold text-foreground">New</span> : null}
      </p>

      <div className="mt-4 min-w-0">
        <p className="m-0 truncate type-body font-medium" title={job.where}>{job.where}</p>
        <p className="m-0 truncate type-body text-muted-foreground">
          <span className={cn(job.experience.over && "text-foreground underline decoration-dashed decoration-1 underline-offset-4")}>{second[0]}</span>
          {second[1] ? ` · ${second[1]}` : null}
        </p>
      </div>

      {job.parts && job.parts.length > 0 ? (
        <div className="mt-4 flex h-1 gap-1" title={job.parts.map((part) => `${part.label} ${part.points} of ${part.max}`).join(", ")}>
          {job.parts.map((part) => (
            <span key={part.label} className="relative overflow-hidden rounded-xs bg-track" style={{ flex: part.max }}>
              <span className="absolute inset-y-0 left-0 rounded-xs bg-bar" style={{ width: `${Math.round((100 * part.points) / Math.max(1, part.max))}%` }} />
            </span>
          ))}
        </div>
      ) : null}

      {skills && have && missing ? (
        <div className="mt-6 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-line pt-4">
          <SkillLine label="You have">
            {have.shown.length > 0 ? (
              <>
                {have.shown.join(", ")}
                <More n={have.more} />
              </>
            ) : (
              <span className="text-muted-foreground">None of its {skills.total} skills</span>
            )}
          </SkillLine>
          <SkillLine label={missingLabel}>
            {missing.shown.length > 0 ? (
              <>
                {missing.shown.map((skill, i) => (
                  <span key={skill}>
                    {i > 0 ? <span className="text-muted-foreground">, </span> : null}
                    <span className={required.has(skill) ? "underline decoration-dashed decoration-1 underline-offset-4" : "text-muted-foreground"}>{skill}</span>
                  </span>
                ))}
                <More n={missing.more} />
              </>
            ) : (
              <span className="text-muted-foreground">Nothing it names</span>
            )}
          </SkillLine>
        </div>
      ) : null}

      {/* The link sits beside the reason, not inside it: in the clamped paragraph it fell on a hidden third line (e2e 18 Nov). */}
      <div className="mt-auto flex items-end gap-3 pt-4">
        <p className="m-0 line-clamp-2 min-w-0 flex-1 type-body text-pretty text-muted-foreground [@media(max-height:790px)]:line-clamp-1">{why}</p>
        {job.detailHref ? (
          <Link
            href={job.detailHref}
            draggable={false}
            onPointerDown={(event) => event.stopPropagation()}
            // The card itself opens the job on a tap: stop here so the page is not pushed twice.
            onClick={(event) => event.stopPropagation()}
            className="flex-none type-body font-medium text-foreground underline decoration-1 underline-offset-4"
          >
            Details
          </Link>
        ) : null}
      </div>
      {stamps}
    </div>
  );
}
