import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { Tag } from "@/components/ui/chip";
import { Icon } from "@/components/ui/icons";
import { CompanyMark } from "@/components/ui/marks";
import { LogoMark } from "@/components/patterns/opening";
import { boardLabel } from "@/lib/board-label";
import { companyPagesEnabled } from "@/lib/company-pages-gate";
import { describe, previewCount, type DescriptionBlock } from "@/lib/description";
import { daysSince, experienceChip, postedLabel, whereLabel } from "@/lib/job-facts";
import { Skeleton } from "@/components/ui/eyebrow";
import { jobPath } from "@/lib/job-slug";
import { similarJobs, type PublicJob } from "@/modules/jobs";
import { formatSalary } from "@/modules/jobs/salary";

// The share page's parts (design/share.html, Phase U): the same facts and description as the signed-in job page, set
// out for someone who has no profile yet.

/** Wordmark on the left; Sign in, or Your feed for someone signed in. */
export function ShareTopBar({ right }: { right: "sign-in" | "feed" | null }) {
  return (
    <div className="flex h-13 flex-none items-center justify-between">
      <LogoMark />
      {right === "sign-in" ? (
        <Link href="/sign-in" className="flex min-h-11 items-center type-body underline decoration-1 underline-offset-4">
          Sign in
        </Link>
      ) : right === "feed" ? (
        <Link href="/feed" className="flex min-h-11 items-center type-body underline decoration-1 underline-offset-4">
          Your feed
        </Link>
      ) : null}
    </div>
  );
}

/** Company, board and posted; the title; place, experience and pay. `score` is the match of a signed-in user. */
export function ShareJobHeader({ job, score }: { job: PublicJob; score?: ReactNode }) {
  const board = boardLabel(job.source);
  const experience = experienceChip({ requiredYears: job.experienceMin, seniority: job.seniority, yourYears: null });
  const salary = formatSalary({ min: job.salaryMin, max: job.salaryMax, currency: job.salaryCurrency, period: job.salaryPeriod });
  return (
    <header className="flex flex-col pt-2">
      <div className="flex items-center gap-3">
        <CompanyMark name={job.company.name} logoUrl={job.company.logoUrl} size={44} />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* The company's own page (Phase W6), while the pages are on and the employer has open jobs. */}
          {companyPagesEnabled() && job.employer && job.employer.openJobs > 0 ? (
            <Link href={`/companies/${job.employer.slug}`} className="truncate type-body font-semibold underline decoration-1 underline-offset-4" title={job.company.name}>
              {job.company.name}
            </Link>
          ) : (
            <span className="truncate type-body font-semibold" title={job.company.name}>
              {job.company.name}
            </span>
          )}
          <span className="truncate type-meta text-muted-foreground">
            {board ? `via ${board}` : "On the company's site"} · {postedLabel(daysSince(job.postedAt)).replace(/^Posted /, "")}
          </span>
        </div>
        {score}
      </div>
      <h1 className="m-0 mt-5 type-heading break-words text-balance">{job.title}</h1>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {job.closedAt ? <Tag className="bg-transparent text-muted-foreground ring-1 ring-line-strong ring-inset">Closed</Tag> : null}
        <Tag className="max-w-full truncate" title={whereLabel(job)}>
          {whereLabel(job)}
        </Tag>
        <Tag>{experience.label}</Tag>
        {salary ? <Tag>{salary}</Tag> : null}
      </div>
    </header>
  );
}

/** The match a signed-in user sees, as on the feed card. */
export function ShareScore({ score, quiet }: { score: number; quiet?: boolean }) {
  return (
    <div className="flex flex-none flex-col items-end">
      <span className={cn("type-score tabular-nums", quiet ? "text-muted-foreground" : "text-brand-text")}>{score}</span>
      <span className="type-meta text-muted-foreground">match</span>
    </div>
  );
}

/** The reading's summary and the lines a candidate checks first ("What they ask for"). */
export function ShareSummary({ job }: { job: PublicJob }) {
  return (
    <>
      {job.summary ? <p className="m-0 mt-4 type-body text-pretty">{job.summary}</p> : null}
      {job.requirements.length > 0 ? (
        <section aria-labelledby="asks" className="mt-6">
          <h2 id="asks" className="m-0 mb-2.5 type-section">
            What they ask for
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {job.requirements.map((line, index) => (
              <li key={index} className="relative pl-4.5 type-body text-pretty before:absolute before:top-[0.68em] before:left-1 before:size-1.5 before:rounded-tag before:bg-foreground">
                {line}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Block({ block }: { block: DescriptionBlock }) {
  if (block.kind === "heading") return <h3 className="m-0 pt-2 type-section leading-snug font-semibold text-balance">{block.text.replace(/\s*:$/, "")}</h3>;
  if (block.kind === "list") {
    return (
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {block.items.map((item, index) => (
          <li key={index} className="relative pl-5 text-pretty before:absolute before:top-[0.68em] before:left-1 before:size-1.5 before:rounded-tag before:bg-foreground">
            {item.label ? <span className="font-semibold">{item.label}: </span> : null}
            {item.text}
          </li>
        ))}
      </ul>
    );
  }
  return <p className="m-0 text-pretty">{block.text}</p>;
}

/** The description, folded: the first blocks, then "Read the full description". */
export function ShareAbout({ job, folded = true }: { job: PublicJob; folded?: boolean }) {
  const blocks = describe(job.description);
  if (blocks.length === 0) return null;
  const shown = folded ? Math.min(previewCount(blocks), 2) : blocks.length;
  const lead = blocks.slice(0, shown);
  const rest = blocks.slice(shown);
  return (
    <section aria-labelledby="about" className="mt-6">
      <h2 id="about" className="m-0 mb-2.5 type-section">
        About the role
      </h2>
      <div className="flex flex-col gap-4 type-body leading-relaxed">
        {lead.map((block, index) => (
          <Block key={index} block={block} />
        ))}
        {rest.length > 0 ? (
          <details className="group flex flex-col gap-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 self-start type-body font-medium underline decoration-1 underline-offset-4 marker:hidden group-open:hidden">
              Read the full description
              <Icon name="chevronRight" size={16} className="rotate-90" />
            </summary>
            <div className="flex flex-col gap-4">
              {rest.map((block, index) => (
                <Block key={index} block={block} />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}

/** The company's own posting, in a new tab: a text link, never a second button. Not for a closed job (it is gone there). */
export function ShareOriginal({ job }: { job: PublicJob }) {
  if (job.closedAt || !job.postingUrl) return null;
  return (
    <a
      href={job.postingUrl}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="mt-1 inline-flex min-h-11 items-center gap-1.5 self-start type-body font-medium underline decoration-1 underline-offset-4"
    >
      View the original posting
      <Icon name="external" size={16} />
    </a>
  );
}

/** What happened to this job, in a dashed panel: closed, a board the agent can't use, not a match, a failed claim. */
export function ShareNotice({ title, children, className }: { title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("mt-5 rounded-card border border-dashed border-dash p-4", className)} role="status">
      <p className="m-0 type-section">{title}</p>
      {children ? <div className="mt-1 type-body text-pretty">{children}</div> : null}
    </div>
  );
}

/** The sticky bottom bar holding the one action. */
export function ShareBar({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 z-10 -mx-5 mt-8 border-t border-line bg-background/90 px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] backdrop-blur-md">{children}</div>;
}

/** Open jobs like this one, each opening its own share page (U6), for a job that can't be applied to. Streamed in. */
export async function SimilarJobs({ jobId }: { jobId: string }) {
  const jobs = await similarJobs(jobId, 3).catch(() => []);
  return (
    <section aria-labelledby="similar" className="mt-6">
      <h2 id="similar" className="m-0 mb-2.5 type-section">
        Open jobs like it
      </h2>
      {jobs.length === 0 ? (
        <p className="m-0 type-body text-muted-foreground">None right now. New jobs come in every day.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link href={jobPath(job)} className="flex min-h-16 items-center gap-3 rounded-card bg-surface p-3 text-foreground no-underline shadow-lift active:bg-sunk">
                <CompanyMark name={job.company.name} logoUrl={job.company.logoUrl} size={36} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate type-body font-semibold" title={job.title}>
                    {job.title}
                  </span>
                  <span className="truncate type-meta text-muted-foreground">
                    {job.company.name} · {whereLabel(job)}
                  </span>
                </span>
                <Icon name="chevronRight" size={16} className="flex-none text-faint" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SimilarJobsLoading() {
  return (
    <div className="mt-6 flex flex-col gap-2.5" aria-busy="true" aria-label="Loading jobs like it">
      <Skeleton className="h-5 w-36" />
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-16 rounded-card" />
      ))}
    </div>
  );
}

/**
 * Inside the LinkedIn, X, Instagram or Facebook app (U8, design/share.html 5–6): Google won't sign anyone in there.
 * Android: one button that opens this page in Chrome. iPhone: a page can't open Safari by itself, so the two steps.
 */
export function OpenInBrowser({ app, os, chromeUrl }: { app: string; os: "android" | "ios" | "other"; chromeUrl: string }) {
  const why = <p className="m-0 mt-2 text-center type-meta text-muted-foreground">Google sign-in doesn&apos;t work inside the {app} app.</p>;
  if (os === "android") {
    return (
      <>
        <a href={chromeUrl} className={buttonVariants({ variant: "primary", size: "xl", className: "w-full" })}>
          Open in Chrome to apply
        </a>
        {why}
      </>
    );
  }
  return (
    <div role="note">
      <p className="m-0 type-section">Open this page in {os === "ios" ? "Safari" : "your browser"} to apply</p>
      <ol className="m-0 mt-2 flex flex-col gap-1 pl-5 type-body">
        <li>
          Tap <span className="rounded-tag bg-sunk px-1.5 font-semibold">•••</span> at the top of the screen
        </li>
        <li>Choose Open in {os === "ios" ? "Safari" : "browser"}</li>
      </ol>
      <p className="m-0 mt-2 type-meta text-muted-foreground">Google sign-in doesn&apos;t work inside the {app} app.</p>
    </div>
  );
}
