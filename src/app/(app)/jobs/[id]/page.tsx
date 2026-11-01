import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { AccentPill } from "@/components/ui/chip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Icon } from "@/components/ui/icons";
import { BoardMark, CompanyMark, MatchBadge } from "@/components/ui/marks";
import { EmptyState } from "@/components/patterns/content";
import { DeckEmptyArt } from "@/components/patterns/drawings";
import { BackTopBar } from "@/components/patterns/top-bar";
import { getCurrentUser } from "@/lib/auth";
import { boardLabel } from "@/lib/board-label";
import { db } from "@/lib/db";
import { describe, previewCount, type DescriptionBlock } from "@/lib/description";
import { feedHref, feedQuery } from "@/lib/feed-url";
import { APPLY_BOARDS, DEFAULT_FEED_DAYS, DEFAULT_PLACES, listFeed, parseFeedFilters, type FeedView } from "@/modules/jobs";
import { FeedBackLink } from "./feed-back-link";
import { JobActions, NextJobLink, type NextJob } from "./job-actions";

type Query = Record<string, string | string[] | undefined>;

const REMOTE_LABEL: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
const FEED_PARAMS = ["boards", "country", "expMax", "days", "level", "stage", "track"] as const;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** "Posted today", "Posted 3d ago", like the card. */
function postedLabel(postedAt: Date) {
  const daysAgo = Math.max(0, Math.floor((Date.now() - postedAt.getTime()) / 86_400_000));
  return daysAgo === 0 ? "Posted today" : `Posted ${daysAgo}d ago`;
}

/** "Today", "Yesterday", "3 days ago", for the facts panel. */
function postedFact(postedAt: Date) {
  const daysAgo = Math.max(0, Math.floor((Date.now() - postedAt.getTime()) / 86_400_000));
  return daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : `${daysAgo} days ago`;
}

/** One fact in the panel: a small label over its value. */
function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 flex min-w-0 flex-col gap-0.5" : "flex min-w-0 flex-col gap-0.5"}>
      <dt className="type-caption text-muted-foreground">{label}</dt>
      <dd className="m-0 flex min-w-0 items-center gap-2 text-[15px] leading-snug font-semibold break-words">{children}</dd>
    </div>
  );
}

/** One block of the description (lib/description.ts), as plain text: nothing from the job board is rendered as markup. */
function Block({ block }: { block: DescriptionBlock }) {
  if (block.kind === "heading") {
    return <h3 className="m-0 pt-2 text-[17px] leading-snug font-semibold text-balance">{block.text.replace(/\s*:$/, "")}</h3>;
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
 * One job in full (opened from the feed card): what the card says, the facts, the whole description set out to read,
 * and Apply or Skip, which swipe it like the deck does and open the next job in the same feed (job-actions.tsx). The
 * query is the feed's filters, so the match score is the one on the card and Back returns to the same feed.
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
  const backHref = withView(feedHref(filters, { boards: APPLY_BOARDS, places: DEFAULT_PLACES, days: DEFAULT_FEED_DAYS }));

  const [job, swipe, application, feed] = await Promise.all([
    db.job.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        location: true,
        remoteType: true,
        experienceMin: true,
        description: true,
        applyUrl: true,
        source: true,
        postedAt: true,
        closedAt: true,
        company: { select: { name: true, logoUrl: true } },
      },
    }),
    db.swipe.findUnique({ where: { userId_jobId: { userId: user.id, jobId: id } }, select: { direction: true } }),
    db.application.findFirst({ where: { userId: user.id, jobId: id }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    // The feed for these filters is cached for a minute (lib/feed-cache.ts), so this is the card's own score and reason.
    listFeed(user.id, filters, view).catch(() => []),
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
  const remote = REMOTE_LABEL[job.remoteType];
  const years = match ? match.requiredYears : job.experienceMin;
  const experience = years == null ? "Not stated" : years <= 0 ? "Entry level" : `${years}+ years`;
  const posted = postedLabel(job.postedAt);
  const why = match?.reason ? (/[.!?]$/.test(match.reason) ? match.reason : `${match.reason}.`) : null;
  const blocks = describe(job.description);
  const shown = previewCount(blocks);
  const lead = blocks.slice(0, shown);
  const rest = blocks.slice(shown);

  // The job after this one in the same feed, as the deck would show it next (the feed already leaves out every job
  // the user swiped). Opened from elsewhere, the first job of the feed.
  const here = feed.findIndex((item) => item.id === job.id);
  const following = (here >= 0 ? feed.slice(here + 1) : feed).find((item) => item.id !== job.id);
  const nextQuery = feedQuery(filters, { boards: APPLY_BOARDS, places: DEFAULT_PLACES, days: DEFAULT_FEED_DAYS });
  const next: NextJob | null = following
    ? { id: following.id, href: withView(nextQuery ? `/jobs/${following.id}?${nextQuery}` : `/jobs/${following.id}`), company: following.company, title: following.title }
    : null;

  return (
    <>
      {/* BackTopBar's look; opened from the deck, Back goes through history (feed-back-link.tsx). */}
      <div className="flex h-11 flex-none items-center gap-1 px-3">
        <FeedBackLink jobId={job.id} href={backHref} ariaLabel="Back to the feed" className="flex size-11 items-center justify-center rounded-full text-foreground">
          <Icon name="back" size={22} strokeWidth={2.25} />
        </FeedBackLink>
        <span className="text-base font-semibold">Job</span>
      </div>
      <div className="flex flex-1 flex-col px-5">
        <header className="relative flex flex-col gap-1.5 pt-3.5">
          <div className="flex items-center gap-3 pr-[92px]">
            <CompanyMark name={job.company.name} logoUrl={job.company.logoUrl} size={56} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-base font-semibold">{job.company.name}</span>
              <span className="text-sm text-muted-foreground">{posted}</span>
            </div>
          </div>
          {match ? <MatchBadge score={match.score} tier={match.tier} className="absolute top-0 right-0" /> : null}
          <h1 className="m-0 mt-4 type-display-md break-words text-balance">{job.title}</h1>
          {match?.isNew ? <AccentPill className="mt-1 h-7 self-start px-2.5 text-xs">New</AccentPill> : null}
        </header>

        {/* The facts at a glance, each with its label, instead of chips that wrap into each other. */}
        <dl aria-label="The job at a glance" className="m-0 mt-5 grid grid-cols-2 gap-x-4 gap-y-3.5 rounded-panel border-[1.5px] border-line bg-surface p-4">
          <Fact label="Location" wide>
            {job.location || "Not listed"}
          </Fact>
          <Fact label="Work type">{remote ?? "Not stated"}</Fact>
          <Fact label="Experience">{experience}</Fact>
          <Fact label="Posted">{postedFact(job.postedAt)}</Fact>
          <Fact label="Job board">
            {board ? (
              <>
                <BoardMark board={board} className="text-foreground" />
                <span className="truncate">{board}</span>
              </>
            ) : (
              "Company site"
            )}
          </Fact>
        </dl>

        {why ? (
          <section aria-label="Why your agent picked it" className="mt-4 flex flex-col gap-1.5 rounded-panel border-[1.5px] border-line bg-surface p-4">
            <Eyebrow as="h2">Why your agent picked it</Eyebrow>
            <p className="m-0 type-lead text-pretty">{why}</p>
            {match?.hint ? <p className="m-0 type-caption text-muted-foreground">{match.hint}</p> : null}
          </section>
        ) : null}

        <section aria-labelledby="about-the-job" className="mt-8 flex flex-col gap-4">
          <Eyebrow as="h2" id="about-the-job">
            About the job
          </Eyebrow>
          {blocks.length === 0 ? (
            <p className="m-0 text-base leading-[1.65] text-muted-foreground">The company did not post a description. The full posting is on {board ?? "their site"}.</p>
          ) : (
            // Body text at 16 px with room between lines; headings, paragraphs and lists come from the text itself.
            <div className="flex flex-col gap-4 text-base leading-[1.65]">
              {lead.map((block, index) => (
                <Block key={index} block={block} />
              ))}
              {rest.length > 0 ? (
                <details className="group flex flex-col gap-4">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-center gap-1.5 rounded-control border-[1.5px] border-line text-[15px] font-semibold marker:hidden group-open:hidden">
                    Read the full description
                    <Icon name="chevronRight" size={16} strokeWidth={2.5} className="rotate-90" />
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
            className="inline-flex min-h-11 items-center gap-1.5 self-start type-caption font-semibold text-muted-foreground underline underline-offset-3"
          >
            Original posting{board ? ` on ${board}` : ""}
            <Icon name="external" size={14} />
          </a>
        </section>

        <div className="sticky bottom-[calc(82px+max(0px,env(safe-area-inset-bottom)-24px))] z-10 -mx-5 mt-8 border-t-[1.5px] border-line bg-background px-5 pt-3 pb-3">
          {application || swipe?.direction === "right" || job.closedAt ? (
            // Already applied to, or closed: say so, and keep going through the feed from here.
            <div className="flex flex-col gap-2">
              <p className="m-0 text-center type-caption text-muted-foreground">
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
              {swipe?.direction === "left" ? <p className="m-0 mb-2 text-center type-caption text-muted-foreground">You skipped this job before. Apply if you&apos;ve changed your mind.</p> : null}
              <JobActions jobId={job.id} company={job.company.name} backHref={backHref} next={next} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
