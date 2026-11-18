import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "cn";
import { Icon } from "@/components/ui/icons";
import { CompanyMark, TierPill, tierFor, type FitTier } from "@/components/ui/marks";

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
  /** "Startup", "Mid-size", "MNC". */
  stage?: string | null;
  /** The job's tech skills the candidate has, and the ones missing (required only when `split`). */
  skills?: { have: string[]; missing: string[]; split: boolean; total: number };
  score: number;
  tier?: FitTier | null;
  /** The job board it came from: "Greenhouse", "Lever", "Ashby". */
  board?: string | null;
  logoUrl?: string | null;
  /** First seen in the last 24 hours. */
  isNew?: boolean;
  /** The job's own page in the app (/jobs/[id]). */
  detailHref?: string;
};

// A skill row's room: the card's 306 px of content less the 68 px label and its gap (measured at 390 px, 18 Nov).
const ROW_PX = 230;
const CHAR_PX = 7.4; // 12.5 px semibold, a little over the widest average measured
const MORE_PX = 26; // "+n"

/** As many chips as fit one row (estimated widths, so nothing is cut mid-word), and how many are left for "+n". */
function fitRow(items: string[], chipPx: number, most = 3) {
  const width = (item: string) => chipPx + CHAR_PX * item.length;
  const shown: string[] = [];
  let used = 0;
  for (const [i, item] of items.entries()) {
    const reserve = i < items.length - 1 ? MORE_PX : 0;
    if (shown.length >= most || (shown.length > 0 && used + width(item) + reserve > ROW_PX)) break;
    shown.push(item);
    used += width(item);
  }
  return { shown, more: items.length - shown.length };
}

function SkillRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-[5px] overflow-hidden">
      <span className="w-[68px] flex-none text-[10.5px] leading-[1.2] font-bold tracking-[0.06em] text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  );
}

const skillChip = "inline-flex h-[25px] flex-none items-center gap-1 rounded-lg px-2 text-[12.5px] font-semibold whitespace-nowrap";

/**
 * The swipe card (design/job-card.html, approved 18 Nov): the exact score and its tier, the role, place / level / pay /
 * company as chips, the job's skills against the candidate's, and one reason. Neutral by default; lime marks what the
 * candidate has or what is good, rose a gap (docs/job-match/TDD.md 11 item 5). Every card has the same frame: long
 * names and titles are cut, chips wrap to two rows at most, and a row of skills ends in "+n" rather than a cut word.
 * Stamps come from the deck, which animates them.
 */
export function JobCard({ job, stamps }: { job: JobCardData; stamps?: ReactNode }) {
  const why = /[.!?]$/.test(job.why) ? job.why : `${job.why}.`;
  const tier = tierFor(job.score, job.tier);
  const skills = job.skills && job.skills.total > 0 ? job.skills : null;
  // A chip is its padding and gap, plus the check icon on the ones the candidate has.
  const have = skills ? fitRow(skills.have, 36) : null;
  const missing = skills ? fitRow(skills.missing, 21) : null;
  return (
    <div className="relative box-border flex h-full flex-col overflow-hidden rounded-card border-2 border-edge bg-surface px-[22px] pt-5 shadow-hard-lg">
      <div className="flex items-center gap-3 border-b-[1.5px] border-line pb-4">
        <CompanyMark name={job.company} logoUrl={job.logoUrl} size={48} />
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="truncate text-base font-bold">{job.company}</span>
          {job.board ? <span className="truncate text-[13px] text-muted-foreground">via {job.board}</span> : null}
        </div>
        <div className="flex flex-none flex-col items-end gap-[5px]">
          <span className="font-display text-[40px] leading-[0.9] font-extrabold tracking-[-0.05em]" aria-label={`${job.score} percent match`}>
            {job.score}
            <span className="ml-px text-lg font-bold text-muted-foreground">%</span>
          </span>
          <TierPill tier={tier} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col pt-4">
        <h2 className="m-0 line-clamp-2 pb-[3px] font-display text-[28px] leading-[1.05] font-extrabold tracking-[-0.035em] break-words" title={job.role}>
          {job.role}
        </h2>
        <div className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          {job.posted}
          {job.isNew ? (
            <span className="inline-flex h-[18px] items-center rounded-full border-[1.5px] border-ink bg-primary px-[7px] text-[10px] font-bold text-ink">New</span>
          ) : null}
        </div>

        <div className="mt-3 flex max-h-16 flex-wrap gap-1.5 overflow-hidden">
          <span className="inline-flex h-[29px] max-w-full min-w-0 items-center gap-[5px] rounded-full bg-muted px-2.5 text-[13px] font-semibold">
            <Icon name="pin" size={14} className="flex-none opacity-65" />
            <span className="truncate">{job.where}</span>
          </span>
          <span
            className={cn(
              "inline-flex h-[29px] flex-none items-center gap-[5px] rounded-full px-2.5 text-[13px] font-semibold whitespace-nowrap",
              job.experience.over ? "bg-gap-bg text-gap" : "bg-muted",
            )}
          >
            <Icon name="clock" size={14} className={cn("flex-none", !job.experience.over && "opacity-65")} />
            {job.experience.label}
          </span>
          {job.salary ? (
            <span className="inline-flex h-[29px] flex-none items-center rounded-full bg-surface px-2.5 text-[13px] font-bold whitespace-nowrap shadow-[inset_0_0_0_1.5px_var(--edge)]">
              {job.salary}
            </span>
          ) : null}
          {job.stage ? <span className="inline-flex h-[29px] flex-none items-center rounded-full bg-muted px-2.5 text-[13px] font-semibold">{job.stage}</span> : null}
        </div>

        {skills && have && missing ? (
          <div className="mt-3.5 flex flex-col gap-1.5">
            <SkillRow label="You have">
              {have.shown.length > 0 ? (
                have.shown.map((skill) => (
                  <span key={skill} className={cn(skillChip, "bg-ok-bg text-ok")}>
                    <Icon name="check" size={11} strokeWidth={3} />
                    {skill}
                  </span>
                ))
              ) : (
                <span className="text-[12.5px] text-muted-foreground">None of its {skills.total} named skills</span>
              )}
              {have.more > 0 ? <span className="flex-none px-0.5 text-[12.5px] font-semibold text-muted-foreground">+{have.more}</span> : null}
            </SkillRow>
            <SkillRow label={skills.split ? "Missing" : "Not on resume"}>
              {missing.shown.length > 0 ? (
                missing.shown.map((skill) => (
                  <span key={skill} className={cn(skillChip, "bg-gap-bg text-gap")}>
                    {skill}
                  </span>
                ))
              ) : (
                <span className="text-[12.5px] text-muted-foreground">{skills.split ? "Nothing it requires" : "Nothing"}</span>
              )}
              {missing.more > 0 ? <span className="flex-none px-0.5 text-[12.5px] font-semibold text-muted-foreground">+{missing.more}</span> : null}
            </SkillRow>
          </div>
        ) : null}

        <div className="mt-auto mb-4 rounded-[14px] bg-background px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">{tier === "stretch" ? "Why it's a stretch" : "Why it fits"}</span>
            {job.detailHref ? (
              <Link
                href={job.detailHref}
                draggable={false}
                onPointerDown={(event) => event.stopPropagation()}
                // The card itself opens the job on a tap: stop here so the page is not pushed twice.
                onClick={(event) => event.stopPropagation()}
                className="inline-flex min-h-6 flex-none items-center gap-0.5 text-xs font-semibold text-foreground underline underline-offset-3"
              >
                See details
                <Icon name="chevronRight" size={12} strokeWidth={2.5} />
              </Link>
            ) : null}
          </div>
          <p className="m-0 mt-[3px] line-clamp-2 text-sm leading-[1.4] text-pretty [@media(max-height:790px)]:line-clamp-1">{why}</p>
        </div>
      </div>
      {stamps}
    </div>
  );
}
