import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Tag, AccentPill } from "@/components/ui/chip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Icon } from "@/components/ui/icons";
import { BoardMark, CompanyMark, MatchBadge } from "@/components/ui/marks";
import { EmptyState } from "@/components/patterns/content";
import { DeckEmptyArt } from "@/components/patterns/drawings";
import { BackTopBar } from "@/components/patterns/top-bar";
import { getCurrentUser } from "@/lib/auth";
import { boardLabel } from "@/lib/board-label";
import { db } from "@/lib/db";
import { feedHref } from "@/lib/feed-url";
import { APPLY_BOARDS, DEFAULT_FEED_DAYS, DEFAULT_PLACES, listFeed, parseFeedFilters } from "@/modules/jobs";
import { FeedBackLink } from "./feed-back-link";
import { JobActions } from "./job-actions";

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

/** The description is stored as one run of plain text (modules/jobs/normalize.ts): a few sentences per paragraph. */
function paragraphs(text: string) {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9•\-–])/);
  const out: string[] = [];
  for (let index = 0; index < sentences.length; index += 3) out.push(sentences.slice(index, index + 3).join(" "));
  return out.filter(Boolean);
}

/**
 * One job in full (opened from the feed card): what the card says, the whole description, and Apply or Skip, which
 * swipe it like the deck does and go back to the feed. The query is the feed's filters, so the match score is the one
 * on the card and Back returns to the same feed.
 */
export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const filters = parseFeedFilters(Object.fromEntries(FEED_PARAMS.map((key) => [key, one(query[key])])));
  // Written like the feed's own URL (lib/feed-url.ts), so Back lands on the exact page the user left.
  const backHref = feedHref(filters, { boards: APPLY_BOARDS, places: DEFAULT_PLACES, days: DEFAULT_FEED_DAYS });

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
    listFeed(user.id, filters).catch(() => []),
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
  const where = [job.location, remote].filter(Boolean).join(" · ") || "Location not listed";
  const years = match ? match.requiredYears : job.experienceMin;
  const asks = years == null ? null : years <= 0 ? "Entry level" : `Asks ${years}+ yrs`;
  const posted = postedLabel(job.postedAt);
  const why = match?.reason ? (/[.!?]$/.test(match.reason) ? match.reason : `${match.reason}.`) : null;
  const text = paragraphs(job.description);
  const lead = text.slice(0, 4);
  const rest = text.slice(4);

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
          <h1 className="m-0 mt-4 type-display-md break-words">{job.title}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            {match?.isNew ? <AccentPill className="h-[34px] px-3 text-sm">New</AccentPill> : null}
            <Tag>{where}</Tag>
            {asks ? <Tag>{asks}</Tag> : null}
            {board ? (
              <Tag className="gap-2 text-muted-foreground">
                <BoardMark board={board} className="text-foreground" />
                via {board}
              </Tag>
            ) : null}
          </div>
        </header>

        {why ? (
          <section aria-label="Why your agent picked it" className="mt-6 flex flex-col gap-1.5 rounded-panel border-[1.5px] border-line bg-surface p-4">
            <Eyebrow as="h2">Why your agent picked it</Eyebrow>
            <p className="m-0 type-lead text-pretty">{why}</p>
            {match?.hint ? <p className="m-0 text-sm text-muted-foreground">{match.hint}</p> : null}
          </section>
        ) : null}

        <section aria-label="About the job" className="mt-7 flex flex-col gap-3">
          <Eyebrow as="h2">About the job</Eyebrow>
          {text.length === 0 ? (
            <p className="m-0 text-[15px] text-muted-foreground">The company did not post a description. The full posting is on {board ?? "their site"}.</p>
          ) : (
            <>
              {lead.map((paragraph, index) => (
                <p key={index} className="m-0 text-[15px] leading-relaxed text-pretty">
                  {paragraph}
                </p>
              ))}
              {rest.length > 0 ? (
                <details className="group flex flex-col gap-3">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-[15px] font-semibold underline underline-offset-3 marker:hidden group-open:hidden">
                    Read the full description
                  </summary>
                  <div className="flex flex-col gap-3">
                    {rest.map((paragraph, index) => (
                      <p key={index} className="m-0 text-[15px] leading-relaxed text-pretty">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          )}
          <a
            href={job.applyUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-muted-foreground underline underline-offset-3"
          >
            Original posting{board ? ` on ${board}` : ""}
            <Icon name="external" size={14} />
          </a>
        </section>

        <div className="sticky bottom-[calc(82px+max(0px,env(safe-area-inset-bottom)-24px))] z-10 -mx-5 mt-auto border-t-[1.5px] border-line bg-background px-5 pt-3 pb-3">
          {application ? (
            <Link href={`/applications/${application.id}`} className={buttonVariants({ variant: "primary", size: "xl", className: "w-full" })}>
              See your application
            </Link>
          ) : swipe ? (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-center text-sm text-muted-foreground">You skipped this job.</p>
              <Link href={backHref} className={buttonVariants({ variant: "line", size: "lg", className: "w-full" })}>
                Back to the feed
              </Link>
            </div>
          ) : job.closedAt ? (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-center text-sm text-muted-foreground">The company has closed this job.</p>
              <Link href={backHref} className={buttonVariants({ variant: "line", size: "lg", className: "w-full" })}>
                Back to the feed
              </Link>
            </div>
          ) : (
            <JobActions jobId={job.id} company={job.company.name} backHref={backHref} />
          )}
        </div>
      </div>
    </>
  );
}
