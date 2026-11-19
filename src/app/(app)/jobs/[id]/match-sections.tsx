import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "cn";
import { Icon } from "@/components/ui/icons";
import type { FitTier } from "@/components/ui/marks";
import type { FeedJob } from "@/modules/jobs";
import type { Breakdown, ScorePart } from "@/modules/jobs/match";

// The job page's match sections (Phase O4, design/craft-b2.html; content from Phase M7). Everything here is read from
// the scorer's own numbers and the job's own skills (FeedJob.breakdown, FeedJob.skills); nothing is written by a model.
// Open sections divided by rules, no panels; meaning by form: a check, an info mark, a dashed underline, grey.

const share = (part: ScorePart) => (part.max === 0 ? 1 : part.points / part.max);
const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
/** "React, Go and SQL", or "REST, SQL, OOP, Python and 8 more" past four. */
const some = (items: string[]) => (items.length <= 4 ? list(items) : `${items.slice(0, 4).join(", ")} and ${items.length - 4} more`);
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

const TIER_WORD: Record<FitTier, string> = { strong: "Strong fit", good: "Good fit", stretch: "A stretch" };

/** The header's match: the tier and the reason on the left, the score large and light in the accent on the right. */
export function MatchHero({ score, tier, reason }: { score: number; tier: FitTier; reason: string }) {
  return (
    <div className="mt-6 flex items-end justify-between gap-6">
      <p className="m-0 type-body text-pretty text-muted-foreground">
        <span className="mb-1 block font-semibold text-foreground">{TIER_WORD[tier]}</span>
        {sentence(reason)}
      </p>
      <span className="flex flex-none flex-col items-end" aria-label={`${score} match`}>
        <span className="type-score text-brand-text">{score}</span>
        <span className="mt-1.5 type-meta text-muted-foreground">match</span>
      </span>
    </div>
  );
}

/** The job at a glance as a labelled grid. `gap` underlines a value that works against the candidate (years over). */
export function JobFacts({ items }: { items: Array<{ label: string; value: string; gap?: boolean; quiet?: boolean }> }) {
  return (
    <dl aria-label="The job at a glance" className="m-0 mt-6 grid grid-cols-2 gap-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="type-meta text-muted-foreground">{item.label}</dt>
          <dd className={cn("m-0 mt-0.5 truncate type-body font-medium", item.quiet && "font-normal text-muted-foreground")} title={item.value}>
            <span className={cn(item.gap && "underline decoration-dashed decoration-1 underline-offset-4")}>{item.value}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** An open section under a rule, with its title and an optional count on the right. */
export function Section({ id, title, aside, className, children }: { id: string; title: ReactNode; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={cn("border-t border-line pt-6", className)}>
      <h2 id={id} className="m-0 mb-4 flex items-baseline justify-between gap-3 type-section">
        <span>{title}</span>
        {aside ? <span className="type-meta font-normal text-muted-foreground tabular-nums">{aside}</span> : null}
      </h2>
      {children}
    </section>
  );
}

/** Matches: parts at 70 % or more of their maximum. Gaps: parts under 50 %, caps that lowered the score, missing skills. */
export function matchesAndGaps(job: Pick<FeedJob, "breakdown" | "skills">) {
  const matches: string[] = [];
  const gaps: string[] = [];
  for (const part of job.breakdown.parts) {
    if (share(part) >= 0.7) {
      if (part.key === "skills" && job.skills.have.length > 0) matches.push(`${part.note.replace(/[.\s]+$/, "")}: ${some(job.skills.have)}.`);
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
    <Section id="why-match" title="Why it's a match">
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {matches.map((text) => (
          <li key={text} className="flex gap-3 type-body text-pretty">
            <Icon name="check" size={16} className="mt-1 flex-none" />
            <span>
              <span className="sr-only">Match: </span>
              {text}
            </span>
          </li>
        ))}
        {gaps.map((text) => (
          <li key={text} className="flex gap-3 type-body text-pretty">
            <Icon name="info" size={16} className="mt-1 flex-none" />
            <span>
              <span className="sr-only">Gap: </span>
              {text}
            </span>
          </li>
        ))}
      </ul>
      {job.quote ? (
        // The requirement line the fit verdict rests on (P6), copied from the posting.
        <figure className="m-0 mt-4">
          <blockquote className="m-0 border-l border-line pl-3 type-body text-pretty">{job.quote}</blockquote>
          <figcaption className="mt-1 pl-3 type-meta text-muted-foreground">From the posting</figcaption>
        </figure>
      ) : null}
      {missing.length > 0 ? (
        <p className="m-0 mt-4 type-meta text-pretty text-muted-foreground">
          Used {list(missing).replace(/ and /, " or ")}?{" "}
          <Link href="/onboarding/confirm" className="font-medium text-foreground underline decoration-1 underline-offset-4">
            Add {missing.length === 1 ? "it" : "them"} to your profile
          </Link>
          .
        </p>
      ) : null}
    </Section>
  );
}

function SkillGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pb-4 last:pb-0">
      <p className="m-0 mb-1 type-meta text-muted-foreground">{label}</p>
      <p className="m-0 type-body">{children}</p>
    </div>
  );
}

/** The job's tech skills against the candidate's; left out when the posting names none. */
export function SkillsPanel({ skills }: { skills: FeedJob["skills"] }) {
  if (skills.total === 0) return null;
  return (
    <Section id="skills" title="Skills" aside={`You have ${skills.have.length} of ${skills.total}`}>
      {skills.have.length > 0 ? <SkillGroup label="On your resume">{skills.have.join(", ")}</SkillGroup> : null}
      {skills.missing.length > 0 ? (
        <SkillGroup label={skills.split ? "Required, not on your resume" : "Not on your resume"}>
          {skills.missing.map((skill, index) => (
            <span key={skill}>
              {index > 0 ? ", " : null}
              <span className="underline decoration-dashed decoration-1 underline-offset-4">{skill}</span>
            </span>
          ))}
        </SkillGroup>
      ) : null}
      {skills.mentioned.length > 0 ? (
        <SkillGroup label="Nice to have, not on your resume">
          <span className="text-muted-foreground">{skills.mentioned.join(", ")}</span>
        </SkillGroup>
      ) : null}
    </Section>
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
    <Section id="how-we-got" title={<>How we got to <span className="tabular-nums">{score}</span></>}>
      <div className="flex flex-col gap-5">
        {breakdown.parts.map((part) => (
          <div key={part.key} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
            <span className="type-body font-medium">{part.label}</span>
            <span className="text-right type-body tabular-nums">
              {part.points} <span className="text-muted-foreground">/ {part.max}</span>
            </span>
            <p className="col-span-2 m-0 type-meta text-muted-foreground">{sentence(part.note)}</p>
            <span className="col-span-2 mt-2 h-1 overflow-hidden rounded-xs bg-track" aria-hidden="true">
              <span className="block h-full rounded-xs bg-bar" style={{ width: `${Math.round(share(part) * 100)}%` }} />
            </span>
          </div>
        ))}
      </div>
      {breakdown.adjustments.length > 0 ? (
        <div className="mt-5 flex flex-col gap-1">
          {breakdown.adjustments.map((adjustment) => (
            <div key={adjustment.key} className="flex justify-between gap-3 type-meta">
              <span className="text-muted-foreground">{adjustment.label}</span>
              <span className="flex-none font-medium tabular-nums">
                {adjustment.effect > 0 ? "+" : ""}
                {adjustment.effect}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-5 flex items-baseline justify-between border-t border-line pt-4">
        <span className="type-body font-semibold">Match</span>
        <span className="type-heading font-medium text-brand-text tabular-nums">{score}</span>
      </div>
      {back ? (
        <p className="m-0 mt-3 type-meta text-pretty text-muted-foreground">
          <span className="font-medium text-foreground">What held it back: </span>
          {back}
        </p>
      ) : null}
    </Section>
  );
}
