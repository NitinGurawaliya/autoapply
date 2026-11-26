import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { CompanyMark, tierFor } from "@/components/ui/marks";
import { EmptyState } from "@/components/patterns/content";
import { DeckEmptyArt } from "@/components/patterns/drawings";
import { BackTopBar } from "@/components/patterns/top-bar";
import { getCurrentUser } from "@/lib/auth";
import { boardLabel } from "@/lib/board-label";
import { db } from "@/lib/db";
import { describe, previewCount, type DescriptionBlock } from "@/lib/description";
import { feedHref, feedQuery } from "@/lib/feed-url";
import { daysSince, experienceChip, postedLabel, STAGE_LABEL, whereLabel } from "@/lib/job-facts";
import { APPLY_BOARDS, DEFAULT_FEED_DAYS, FEED_BOARDS, DEFAULT_PLACES, listFeed, parseFeedFilters, type FeedView } from "@/modules/jobs";
import { formatSalary } from "@/modules/jobs/salary";
import { absoluteUrl, jobPath } from "@/lib/job-slug";
import { shareLinksEnabled } from "@/lib/share-gate";
import { SITES } from "@/modules/sources/sites";
import { FeedBackLink } from "./feed-back-link";
import { ShareButton } from "./share-button";
import { JobActions, NextJobLink, type NextJob } from "./job-actions";
import { JobFacts, MatchHero, ScoreBreakdown, Section, SkillsPanel, WhyMatch } from "./match-sections";

type Query = Record<string, string | string[] | undefined>;

const FEED_PARAMS = ["boards", "country", "expMax", "days", "level", "stage", "track"] as const;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** One block of the description (lib/description.ts), as plain text: nothing from the job board is rendered as markup. */
function Block({ block }: { block: DescriptionBlock }) {
  if (block.kind === "heading") {
    return <h3 className="m-0 pt-2 type-section leading-snug font-semibold text-balance">{block.text.replace(/\s*:$/, "")}</h3>;
  }
  if (block.kind === "list") {
    return (
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {block.items.map((item, index) => (
          <li key={index} className="relative pl-5 text-pretty before:absolute before:top-[0.68em] before:left-1 before:size-1.5 before:rounded-full before:bg-foreground">
            {item.label ? <span className="font-semibold">{item.label}: </span> : null}
            {item.text}
          </li>
        ))}
      </ul>
    );
  }
  return <p className="m-0 text-pretty">{block.text}</p>;
}

/**
 * One job in full (opened from the feed card; design/job.html, Phase M7): the score and the facts, why it is a match
 * (matches and gaps), the job's skills against the candidate's, the whole description set out to read, how the score
 * was reached, and Apply or Skip, which swipe it like the deck does and open the next job in the same feed
 * (job-actions.tsx). The query is the feed's filters, so the match score is the one on the card and Back returns to the
 * same feed. A job no longer in the feed (applied to, closed) shows its facts and description only.
 */
export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const filters = parseFeedFilters(Object.fromEntries(FEED_PARAMS.map((key) => [key, one(query[key])])));
  // Opened from the "jobs you skipped" view: its next job and its Back stay in that view.
  const view: FeedView = one(query.view) === "skipped" ? "skipped" : "new";
  const withView = (href: string) => (view === "skipped" ? `${href}${href.includes("?") ? "&" : "?"}view=skipped` : href);
  // Written like the feed's own URL (lib/feed-url.ts), so Back lands on the exact page the user left.
  const backHref = withView(feedHref(filters, { boards: FEED_BOARDS, places: DEFAULT_PLACES, days: DEFAULT_FEED_DAYS }));

  const [job, swipe, application, feed, profile] = await Promise.all([
    db.job.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        location: true,
        remoteType: true,
        experienceMin: true,
        seniority: true,
        description: true,
        applyUrl: true,
        source: true,
        postedAt: true,
        closedAt: true,
        salaryMin: true,
        salaryMax: true,
        salaryCurrency: true,
        salaryPeriod: true,
        company: { select: { name: true, logoUrl: true, stage: true } },
      },
    }),
    db.swipe.findUnique({ where: { userId_jobId: { userId: user.id, jobId: id } }, select: { direction: true } }),
    db.application.findFirst({ where: { userId: user.id, jobId: id }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    // The feed for these filters is cached for a minute (lib/feed-cache.ts), so this is the card's own score and reason.
    listFeed(user.id, filters, view).catch(() => []),
    // The user's years, for a job no longer in the feed (e2e finding 5: it read "you have 0" for a 2-year user).
    db.profile.findUnique({ where: { userId: user.id }, select: { yearsExperience: true } }),
  ]);

  if (!job) {
    return (
      <>
        <BackTopBar href={backHref} label="Job" backLabel="Back to the feed" />
        <EmptyState
          art={<DeckEmptyArt />}
          title="Job not found"
          text="It may have been taken down by the company."
          actions={
            <Link href={backHref} className={buttonVariants({ variant: "primary", size: "xl", className: "w-full" })}>
              Back to the feed
            </Link>
          }
        />
      </>
    );
  }

  const match = feed.find((item) => item.id === job.id);
  const board = boardLabel(job.source);
  const daysAgo = daysSince(job.postedAt);
  // From the card's own feed item when the job is in the feed, else from the stored job (the same rules).
  const experience = match ? experienceChip(match) : experienceChip({ requiredYears: job.experienceMin, seniority: job.seniority, yourYears: profile?.yearsExperience ?? null });
  const salary = match ? match.salary : formatSalary({ min: job.salaryMin, max: job.salaryMax, currency: job.salaryCurrency, period: job.salaryPeriod });
  const stage = job.company.stage ? (STAGE_LABEL[job.company.stage] ?? null) : null;
  const blocks = describe(job.description);
  const shown = previewCount(blocks);
  const lead = blocks.slice(0, shown);
  const rest = blocks.slice(shown);

  // The job after this one in the same feed, as the deck would show it next (the feed already leaves out every job
  // the user swiped). Opened from elsewhere, the first job of the feed.
  const here = feed.findIndex((item) => item.id === job.id);
  const following = (here >= 0 ? feed.slice(here + 1) : feed).find((item) => item.id !== job.id);
  const nextQuery = feedQuery(filters, { boards: FEED_BOARDS, places: DEFAULT_PLACES, days: DEFAULT_FEED_DAYS });
  const next: NextJob | null = following
    ? { id: following.id, href: withView(nextQuery ? `/jobs/${following.id}?${nextQuery}` : `/jobs/${following.id}`), company: following.company, title: following.title }
    : null;

  return (
    <>
      {/* BackTopBar's look; opened from the deck, Back goes through history (feed-back-link.tsx). */}
      <div className="flex h-11 flex-none items-center gap-1 px-3">
        <FeedBackLink jobId={job.id} href={backHref} ariaLabel="Back to the feed" className="flex size-11 items-center justify-center rounded-control text-foreground active:bg-sunk">
          <Icon name="back" size={22} />
        </FeedBackLink>
        <span className="type-body font-medium">Feed</span>
        <span className="flex-1" />
        {/* Share links (Phase U9): only for an open job the agent applies to (never a Naukri one: not republished), while share pages are switched on. */}
        {shareLinksEnabled() && !job.closedAt && APPLY_BOARDS.includes(job.source) && !(SITES as readonly string[]).includes(job.source) ? (
          <ShareButton url={absoluteUrl(`${jobPath({ id: job.id, title: job.title, company: job.company })}?s=app`)} title={`${job.title} at ${job.company.name}`} />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col px-6">
        <header className="flex flex-col pt-2">
          <div className="flex items-center gap-3">
            <CompanyMark name={job.company.name} logoUrl={job.company.logoUrl} size={40} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate type-body font-semibold">{job.company.name}</span>
              <span className="truncate type-meta text-muted-foreground">
                {board ? `via ${board}` : "On the company's site"} · {postedLabel(daysAgo).replace(/^Posted /, "")}
                {match?.isNew ? <span className="font-semibold text-foreground"> · New</span> : null}
              </span>
            </div>
          </div>
          <h1 className="m-0 mt-6 type-heading break-words text-balance">{job.title}</h1>
          {match ? <MatchHero score={match.score} tier={tierFor(match.score, match.tier)} reason={match.reason} /> : null}
          <JobFacts
            items={[
              { label: "Location", value: whereLabel(job) },
              { label: "Experience", value: experience.label, gap: experience.over },
              { label: "Pay", value: salary ?? "Not published", quiet: !salary },
              ...(stage ? [{ label: "Company", value: stage }] : []),
            ]}
          />
          {match?.hint ? <p className="m-0 mt-4 type-meta text-muted-foreground">{match.hint}</p> : null}
        </header>

        <div className="mt-8 flex flex-col gap-8">
          {match ? <WhyMatch job={match} /> : null}
          {match ? <SkillsPanel skills={match.skills} /> : null}
        </div>

        <Section id="about-the-job" title="About the role" className="mt-8 flex flex-col gap-4">
          {blocks.length === 0 ? (
            <p className="m-0 type-body leading-relaxed text-muted-foreground">The company did not post a description. The full posting is on {board ?? "their site"}.</p>
          ) : (
            // Body text at 16 px with room between lines; headings, paragraphs and lists come from the text itself.
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
          )}
          <a
            href={job.applyUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 self-start type-meta font-medium text-muted-foreground underline decoration-1 underline-offset-4"
          >
            Original posting{board ? ` on ${board}` : ""}
            <Icon name="external" size={14} />
          </a>
        </Section>

        {match ? (
          <div className="mt-8">
            <ScoreBreakdown score={match.score} breakdown={match.breakdown} />
          </div>
        ) : null}

        <div className="sticky bottom-[calc(82px+max(0px,env(safe-area-inset-bottom)-24px))] z-10 -mx-6 mt-8 border-t border-line bg-background/90 px-4 pt-3 pb-3 backdrop-blur-md">
          {application || swipe?.direction === "right" || job.closedAt ? (
            // Already applied to, or closed: say so, and keep going through the feed from here.
            <div className="flex flex-col gap-2">
              <p className="m-0 text-center type-meta text-muted-foreground">
                {application ? "Your agent has this one." : job.closedAt ? "The company has closed this job." : "You applied to this job."}
              </p>
              <div className="flex gap-3">
                {application ? (
                  <Link href={`/applications/${application.id}`} className={buttonVariants({ variant: "line", size: "lg", className: "flex-1" })}>
                    See your application
                  </Link>
                ) : (
                  <Link href={backHref} className={buttonVariants({ variant: "line", size: "lg", className: "flex-1" })}>
                    Back to the feed
                  </Link>
                )}
                {next ? <NextJobLink jobId={job.id} next={next} className={buttonVariants({ variant: "primary", size: "lg", className: "flex-1" })} /> : null}
              </div>
            </div>
          ) : (
            <>
              {/* Skipped before: it can still be applied to (lib: swipeRight turns the skip into the apply). */}
              {swipe?.direction === "left" ? <p className="m-0 mb-2 text-center type-meta text-muted-foreground">You skipped this job before. Apply if you&apos;ve changed your mind.</p> : null}
              <JobActions jobId={job.id} company={job.company.name} backHref={backHref} next={next} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
