import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Screen } from "@/components/patterns/layout";
import { getCurrentUser } from "@/lib/auth";
import { readShareIntent } from "@/lib/share-intent";
import { boardLabel } from "@/lib/board-label";
import { explainOutcome } from "@/lib/explain";
import { absoluteUrl, jobIdFromSlug, jobPath } from "@/lib/job-slug";
import { shareLinksEnabled } from "@/lib/share-gate";
import { publicJob, type PublicJob } from "@/modules/jobs";
import { shareMatchScore, shareOutcome, trackShareStep, type ShareOutcome } from "@/modules/share";
import { funnelSource } from "@/lib/funnel";
import { chromeIntentUrl, inAppBrowser } from "@/lib/in-app-browser";
import { headers } from "next/headers";
import { applyFromShare } from "./actions";
import { ApplySubmit } from "./apply-button";
import { ShareClaim } from "./share-claim";
import { OpenInBrowser, ShareAbout, ShareBar, ShareJobHeader, ShareNotice, ShareOriginal, ShareScore, ShareSummary, ShareTopBar, SimilarJobs, SimilarJobsLoading } from "./share-sections";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function load(slug: string): Promise<PublicJob | null> {
  if (!shareLinksEnabled()) return null;
  const id = jobIdFromSlug(slug);
  return id ? publicJob(id) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const job = await load((await params).slug);
  if (!job) return { title: "SwipeApply", robots: { index: false, follow: false } };
  const title = `${job.title} at ${job.company.name}`;
  const description = job.closedAt
    ? `${job.company.name} has closed this job. See open jobs like it on SwipeApply.`
    : (job.summary ?? `${job.title} at ${job.company.name}. Upload your resume once and your agent applies for you.`);
  const url = absoluteUrl(jobPath(job));
  return {
    metadataBase: new URL(absoluteUrl("/")),
    title,
    description,
    alternates: { canonical: url },
    // Not indexed in this phase (docs/share/TDD.md §1): the posting belongs to the company.
    robots: { index: false, follow: false },
    openGraph: { type: "website", siteName: "SwipeApply", title, description, url },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** A signed-in user's match, streamed in: the swipe's own score may take a moment for a job their feed never showed. */
async function MatchScore({ userId, jobId, quiet }: { userId: string; jobId: string; quiet?: boolean }) {
  const score = await shareMatchScore(userId, jobId);
  return score == null ? null : <ShareScore score={score} quiet={quiet} />;
}

/** "Go and Kubernetes", "Go, Kubernetes and Docker". */
function listed(items: string[]) {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Why the agent stopped, for an application the rules blocked (design/share.html 10). */
function StoppedNotice({ outcome }: { outcome: ShareOutcome }) {
  if (outcome.rule === "min_match_score") {
    return (
      <ShareNotice title="Your agent won't apply to this one">
        {outcome.missing.length > 0 ? `It asks for ${listed(outcome.missing)}, which your resume doesn't show.` : "It fits your resume too loosely."}
      </ShareNotice>
    );
  }
  const explained = explainOutcome("blocked", outcome.rule);
  return <ShareNotice title={explained.headline}>{explained.next}</ShareNotice>;
}

/**
 * A job shared on LinkedIn or X (Phase U, docs/share/TDD.md §4.1 item 2; design/share.html): public, outside the
 * signed-in shell. Open and on a board the agent applies on: the facts, what they ask for, the description, Apply.
 * Closed, or a board the agent can't use: said plainly, no Apply.
 */
export default async function SharePage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const job = await load(slug);
  if (!job) notFound();

  // The text part is for people; the id is the key. A different text (an old title, a typo) goes to today's path.
  const canonical = jobPath(job);
  if (`/j/${decodeURIComponent(slug)}` !== canonical) {
    const rest = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) for (const one of Array.isArray(value) ? value : value ? [value] : []) rest.append(key, one);
    permanentRedirect(rest.size > 0 ? `${canonical}?${rest}` : canonical);
  }

  const [user, intent, requestHeaders] = await Promise.all([getCurrentUser(), readShareIntent(), headers()]);
  // Inside the LinkedIn, X, Instagram or Facebook app, Google refuses sign-in (U8): a signed-out visitor opens the page in
  // their browser first. Signed in, Apply needs no Google, so it stays.
  const inApp = user ? null : inAppBrowser(requestHeaders.get("user-agent"));
  const hasProfile = Boolean(user?.hasProfile);
  const open = !job.closedAt && job.applyable;
  const board = boardLabel(job.source);
  // The funnel (U7): this view, with the link's source; signed in with this job's intent is the return from Google.
  await trackShareStep("view", { jobId: job.id, userId: user?.id ?? null, source: funnelSource(query.s), detail: inApp ? "in_app_browser" : null });
  if (user && intent === job.id) await trackShareStep("signed_in", { jobId: job.id, userId: user.id });
  // Back from Google after tapping Apply, with no profile yet: on to the resume step, the job carried by the intent.
  if (user && !hasProfile && open && intent === job.id) redirect("/onboarding/resume");
  // What already happened to this job for this user (U5): handed to the agent, or stopped by a rule.
  const outcome = user && hasProfile ? await shareOutcome(user.id, job.id) : null;
  const stopped = outcome?.status === "blocked" ? outcome : null;

  return (
    <Screen className="px-5">
      <ShareTopBar right={user ? "feed" : "sign-in"} />
      <ShareJobHeader
        job={job}
        score={
          user && hasProfile && open ? (
            <Suspense fallback={null}>
              <MatchScore userId={user.id} jobId={job.id} quiet={stopped?.rule === "min_match_score"} />
            </Suspense>
          ) : null
        }
      />

      {job.closedAt ? (
        <ShareNotice title="This job has closed">{job.company.name} stopped taking applications for it.</ShareNotice>
      ) : !job.applyable ? (
        <ShareNotice title="Your agent can't apply here yet">
          {job.company.name} takes applications on {board ?? "its own site"}, which needs an account with each employer.
          <br />
          <ShareOriginal job={job} />
        </ShareNotice>
      ) : stopped ? (
        <StoppedNotice outcome={stopped} />
      ) : null}

      {/* Where it can't be applied to, the way on comes first (U6): open jobs like it, then this job's facts. */}
      {!open || stopped ? (
        <Suspense fallback={<SimilarJobsLoading />}>
          <SimilarJobs jobId={job.id} />
        </Suspense>
      ) : null}
      <ShareSummary job={job} />
      {open ? <ShareAbout job={job} /> : null}
      {open ? <ShareOriginal job={job} /> : null}
      <div className="flex-1" />

      {open ? (
        <ShareBar>
          {stopped ? (
            <Link href="/feed" className={buttonVariants({ variant: "primary", size: "xl", className: "w-full" })}>
              See today&apos;s jobs
            </Link>
          ) : outcome ? (
            <>
              <p className="m-0 mb-2 text-center type-meta text-muted-foreground">Your agent has this one.</p>
              <Link href={`/applications/${outcome.applicationId}`} className={buttonVariants({ variant: "line", size: "xl", className: "w-full" })}>
                See your application
              </Link>
            </>
          ) : user && hasProfile ? (
            <ShareClaim jobId={job.id} path={canonical} auto={intent === job.id} />
          ) : inApp ? (
            <OpenInBrowser app={inApp.app} os={inApp.os} chromeUrl={chromeIntentUrl(absoluteUrl(canonical + (funnelSource(query.s) ? `?s=${funnelSource(query.s)}` : "")))} />
          ) : (
            <>
              <form action={applyFromShare.bind(null, job.id)}>
                <ApplySubmit />
              </form>
              <p className="m-0 mt-2 text-center type-meta text-muted-foreground">Upload your resume once. Your agent fills in the form and sends it.</p>
            </>
          )}
        </ShareBar>
      ) : (
        <div className="h-8" />
      )}
    </Screen>
  );
}
