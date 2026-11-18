import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "cn";
import { Icon } from "@/components/ui/icons";
import type { FeedJob } from "@/modules/jobs";
import type { Breakdown, ScorePart } from "@/modules/jobs/match";

// The job page's match sections (Phase M7, design/job.html, approved 18 Nov). Everything here is read from the
// scorer's own numbers and the job's own skills (FeedJob.breakdown, FeedJob.skills); nothing is written by a model.
// Neutral by default: lime = you have it / good, rose = a gap (docs/job-match/TDD.md 11 item 5).

const share = (part: ScorePart) => (part.max === 0 ? 1 : part.points / part.max);
const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
/** "React, Go and SQL", or "REST, SQL, OOP, Python and 8 more" past four. */
const some = (items: string[]) => (items.length <= 4 ? list(items) : `${items.slice(0, 4).join(", ")} and ${items.length - 4} more`);
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** The score as a ring that fills to it (ink in light, lime in dark, like the progress bars). */
export function ScoreRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 38;
  return (
    <div className="relative size-[88px] flex-none" role="img" aria-label={`${score} percent match`}>
      <svg viewBox="0 0 88 88" className="size-[88px] -rotate-90" aria-hidden="true">
        <circle cx="44" cy="44" r="38" fill="none" stroke="var(--track)" strokeWidth="8" />
        <circle cx="44" cy="44" r="38" fill="none" stroke="var(--bar)" strokeWidth="8" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, score)) / 100)} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-[30px] font-extrabold tracking-[-0.05em]">{score}</span>
    </div>
  );
}

/** A fact chip in the header: grey, rose when it is a gap, a quiet outline when the board gives nothing. */
export function FactChip({ icon, tone = "plain", children }: { icon?: "pin" | "clock"; tone?: "plain" | "gap" | "quiet"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-[30px] max-w-full min-w-0 items-center gap-[5px] rounded-full px-2.5 text-[13px] whitespace-nowrap",
        tone === "plain" && "bg-muted font-semibold",
        tone === "gap" && "bg-gap-bg font-semibold text-gap",
        tone === "quiet" && "font-medium text-muted-foreground shadow-[inset_0_0_0_1.5px_var(--line-strong)]",
      )}
    >
      {icon ? <Icon name={icon} size={14} className={cn("flex-none", tone !== "gap" && "opacity-65")} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

function SectionTitle({ id, children, aside }: { id: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <h2 id={id} className="m-0 mb-3 flex items-center gap-2 font-display text-2xl font-extrabold tracking-[-0.03em]">
      {children}
      {aside ? <span className="ml-auto flex gap-1.5 font-sans text-[13px] font-bold tracking-normal">{aside}</span> : null}
    </h2>
  );
}

const eyebrow = "mt-[18px] mb-2 block text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase";

function Mark({ yes }: { yes: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn("mt-px flex size-[22px] flex-none items-center justify-center rounded-full", yes ? "border-[1.5px] border-ink bg-primary text-ink" : "bg-gap-bg text-gap")}
    >
      <Icon name={yes ? "check" : "closeSmall"} size={12} strokeWidth={3} />
    </span>
  );
}

/** Matches: parts at 70 % or more of their maximum. Gaps: parts under 50 %, caps that lowered the score, missing skills. */
export function matchesAndGaps(job: Pick<FeedJob, "breakdown" | "skills">) {
  const matches: string[] = [];
  const gaps: string[] = [];
  for (const part of job.breakdown.parts) {
    if (share(part) >= 0.7) {
      if (part.key === "skills" && job.skills.have.length > 0) matches.push(`${sentence(part.note)}: ${some(job.skills.have)}.`);
      else if (part.key === "work") matches.push("The work is like your own.");
      else matches.push(sentence(part.note));
    } else if (share(part) < 0.5) {
      // The missing skills get their own lines below; the part's note would say the same thing.
      if (part.key === "skills" && job.skills.missing.length + job.skills.mentioned.length > 0) continue;
      gaps.push(part.key === "work" ? `The work is only partly like yours. ${sentence(part.note)}` : sentence(part.note));
    }
  }
  for (const adjustment of job.breakdown.adjustments) if (adjustment.effect < 0 && adjustment.key !== "ceiling") gaps.push(sentence(adjustment.label));
  if (job.skills.missing.length > 0) {
    gaps.push(`${job.skills.split ? "Requires" : "Names"} ${some(job.skills.missing)}, which ${job.skills.missing.length === 1 ? "isn't" : "aren't"} on your resume.`);
  }
  if (job.skills.mentioned.length > 0) {
    const also = job.skills.missing.length > 0 ? "Also names" : "Names";
    gaps.push(`${also} ${some(job.skills.mentioned)} as nice to have, which ${job.skills.mentioned.length === 1 ? "isn't" : "aren't"} on your resume.`);
  }
  return { matches, gaps };
}

export function WhyMatch({ job }: { job: FeedJob }) {
  const { matches, gaps } = matchesAndGaps(job);
  const missing = job.skills.missing.slice(0, 3);
  return (
    <section aria-labelledby="why-match">
      <SectionTitle
        id="why-match"
        aside={
          <>
            <span className="inline-flex h-6 items-center rounded-full bg-ok-bg px-2 text-ok">{matches.length} ✓</span>
            {gaps.length > 0 ? <span className="inline-flex h-6 items-center rounded-full bg-gap-bg px-2 text-gap">{gaps.length} ✕</span> : null}
          </>
        }
      >
        Why this is a match
      </SectionTitle>
      <div className="rounded-panel border-[1.5px] border-line bg-surface p-[18px]">
        <p className="m-0 text-base leading-normal font-medium text-pretty">{sentence(job.reason)}</p>
        {matches.length > 0 ? (
          <>
            <span className={eyebrow}>Matches · {matches.length}</span>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {matches.map((text) => (
                <li key={text} className="flex gap-2 text-[15px] leading-[1.45] text-pretty">
                  <Mark yes />
                  {text}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {gaps.length > 0 ? (
          <>
            <span className={eyebrow}>Gaps · {gaps.length}</span>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {gaps.map((text) => (
                <li key={text} className="flex gap-2 text-[15px] leading-[1.45] text-pretty">
                  <Mark yes={false} />
                  {text}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {missing.length > 0 ? (
          <p className="m-0 mt-[18px] rounded-[14px] bg-background px-3.5 py-3 text-sm leading-[1.45] text-pretty">
            Used {list(missing).replace(/ and /, " or ")}?{" "}
            <Link href="/onboarding/confirm" className="font-bold text-foreground underline underline-offset-3">
              Add {missing.length === 1 ? "it" : "them"} to your profile
            </Link>{" "}
            so your agent can say so on the form.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SkillChips({ items, tone }: { items: string[]; tone: "have" | "missing" | "mentioned" }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((skill) => (
        <span
          key={skill}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[13px] font-semibold",
            tone === "have" && "bg-ok-bg text-ok",
            tone === "missing" && "bg-gap-bg text-gap",
            tone === "mentioned" && "text-muted-foreground shadow-[inset_0_0_0_1.5px_var(--line-strong)]",
          )}
        >
          {tone === "have" ? <Icon name="check" size={12} strokeWidth={3} /> : null}
          {skill}
        </span>
      ))}
    </div>
  );
}

/** The job's tech skills against the candidate's; left out when the posting names none. */
export function SkillsPanel({ skills }: { skills: FeedJob["skills"] }) {
  if (skills.total === 0) return null;
  return (
    <section aria-labelledby="skills">
      <SectionTitle id="skills">Skills</SectionTitle>
      <div className="rounded-panel border-[1.5px] border-line bg-surface p-[18px]">
        <div className="flex items-center gap-2.5 text-[13px] font-semibold text-muted-foreground">
          <span>
            You cover {skills.have.length} of {skills.total}
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-track">
            <span className="block h-full rounded-full bg-bar" style={{ width: `${Math.round((100 * skills.have.length) / skills.total)}%` }} />
          </span>
        </div>
        {skills.have.length > 0 ? (
          <>
            <span className={eyebrow}>On your resume · {skills.have.length}</span>
            <SkillChips items={skills.have} tone="have" />
          </>
        ) : null}
        {skills.missing.length > 0 ? (
          <>
            <span className={eyebrow}>
              {skills.split ? "Required, not on your resume" : "Not on your resume"} · {skills.missing.length}
            </span>
            <SkillChips items={skills.missing} tone="missing" />
          </>
        ) : null}
        {skills.mentioned.length > 0 ? (
          <>
            <span className={eyebrow}>Nice to have, not on your resume · {skills.mentioned.length}</span>
            <SkillChips items={skills.mentioned} tone="mentioned" />
          </>
        ) : null}
        <p className="m-0 mt-3.5 text-[13px] leading-[1.45] text-muted-foreground">Only the tech the posting names. Your profile skills and resume both count as having it.</p>
      </div>
    </section>
  );
}

/** The part with the most points missing, or a cap that cost more. */
function heldBack(breakdown: Breakdown) {
  const part = [...breakdown.parts].sort((a, b) => b.max - b.points - (a.max - a.points))[0];
  const cap = [...breakdown.adjustments].filter((item) => item.effect < 0 && item.key !== "ceiling").sort((a, b) => a.effect - b.effect)[0];
  if (cap && (!part || -cap.effect > part.max - part.points)) return sentence(cap.label);
  if (!part || part.points >= part.max) return null;
  return `${part.label}: ${part.max - part.points} of ${part.max} points missing. ${sentence(part.note)}`;
}

/** Every part out of its maximum, then any cap or floor, then the total; they add up to the number on the card. */
export function ScoreBreakdown({ score, breakdown }: { score: number; breakdown: Breakdown }) {
  if (breakdown.parts.length === 0) return null;
  const back = heldBack(breakdown);
  return (
    <section aria-labelledby="how-we-got">
      <SectionTitle id="how-we-got">How we got to {score}</SectionTitle>
      <div className="rounded-panel border-[1.5px] border-line bg-surface p-[18px]">
        {breakdown.parts.map((part) => (
          <div key={part.key} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-b-[1.5px] border-line py-3 first:pt-0">
            <span className="text-[15px] font-semibold">{part.label}</span>
            <span className={cn("text-right text-[15px] font-bold tabular-nums", share(part) < 0.5 && "text-gap")}>
              {part.points} <span className="font-medium text-muted-foreground">/ {part.max}</span>
            </span>
            <p className="col-span-2 m-0 text-[13px] leading-[1.4] text-muted-foreground">{sentence(part.note)}</p>
            <span className="col-span-2 mt-1.5 h-1.5 overflow-hidden rounded-full bg-track" aria-hidden="true">
              <span className="block h-full rounded-full bg-bar" style={{ width: `${Math.round(share(part) * 100)}%` }} />
            </span>
          </div>
        ))}
        <div className="flex flex-col gap-1 border-b-[1.5px] border-line py-3">
          {breakdown.adjustments.length === 0 ? (
            <div className="flex justify-between text-[15px]">
              <span className="text-muted-foreground">Caps and floors</span>
              <span className="text-muted-foreground">none</span>
            </div>
          ) : (
            breakdown.adjustments.map((adjustment) => (
              <div key={adjustment.key} className="flex justify-between gap-3 text-[15px]">
                <span className="text-muted-foreground">{adjustment.label}</span>
                <span className={cn("flex-none font-bold tabular-nums", adjustment.effect < 0 && "text-gap")}>
                  {adjustment.effect > 0 ? "+" : ""}
                  {adjustment.effect}
                </span>
              </div>
            ))
          )}
        </div>
        <div className="flex items-baseline justify-between pt-3.5">
          <span className="text-base font-bold">Match score</span>
          <span className="font-display text-[32px] font-extrabold tracking-[-0.04em]">{score}</span>
        </div>
        {back ? (
          <div className="mt-3 rounded-[14px] bg-background px-3.5 py-3 text-sm leading-[1.45] text-pretty">
            <span className="mb-1 block text-[11px] font-bold tracking-[0.08em] text-gap uppercase">What held it back</span>
            {back}
          </div>
        ) : null}
      </div>
    </section>
  );
}
