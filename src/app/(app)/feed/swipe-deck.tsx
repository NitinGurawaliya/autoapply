"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { SoftChip } from "@/components/ui/chip";
import { Icon } from "@/components/ui/icons";
import { SegmentedProgress } from "@/components/ui/segmented-progress";
import { EmptyState } from "@/components/patterns/content";
import { DeckDoneArt } from "@/components/patterns/drawings";
import { JobCardSkeleton, type JobCardData } from "@/components/patterns/job-card";
import { StackCount, SwipeStage, type Direction, type SwipeStageHandle } from "@/components/patterns/swipe-stage";
import { AgentToast } from "@/components/patterns/agent-toast";
import { DailyReveal, type RevealPick } from "@/components/patterns/daily-reveal";
import { useApplicationsSummary } from "@/components/applications-summary";
import { boardLabel } from "@/lib/board-label";
import { experienceChip, postedLabel, STAGE_LABEL, whereLabel } from "@/lib/job-facts";
import { statusMeta } from "@/lib/status-meta";
import type { DailyView, FeedJob, FeedView } from "@/modules/jobs";
import { markOpenedFromFeed } from "../jobs/[id]/feed-back-link";

// More cards are fetched in the background while this many or fewer are left, so the deck never runs dry while more
// jobs match (owner, 27 Nov: "keep fetching in the background so the user doesn't have to reload").
const REFILL_BELOW = 10;
const TOAST_POLL_MS = 1500;
// While the agent works the toast stays (a mock run takes ~30 s, a wait in the queue can be longer); a new right swipe
// replaces it. Once the outcome is in: sent and needs-you go quickly (the needs-you sheet opens by itself), a
// didn't-go-through stays long enough to read why.
const TOAST_LIVE_MAX_MS = 60_000;
const TOAST_AFTER_SENT_MS = 1600;
const TOAST_AFTER_STOP_MS = 4000;

/** The day (YYYY-MM-DD, local) this device last played the swipe hint. */
const HINT_KEY = "swipeapply:swipe-hint";

function cardData(job: FeedJob, query: string): JobCardData {
  return {
    company: job.company,
    role: job.title,
    posted: postedLabel(job.daysAgo),
    why: job.reason,
    where: whereLabel(job),
    experience: experienceChip(job),
    salary: job.salary,
    stage: job.stage ? (STAGE_LABEL[job.stage] ?? null) : null,
    skills: job.skills,
    parts: job.breakdown.parts,
    score: job.score,
    tier: job.tier,
    board: boardLabel(job.source),
    logoUrl: job.logoUrl,
    isNew: job.isNew,
    detailHref: jobHref(job.id, query),
    learned: job.learnedNote,
  };
}

/** The job's page; it carries the feed's filters so its score matches the card and Back returns to the same feed. */
/** A job as the reveal's arc shows it (Phase R): the same facts as the card, smaller. */
function revealPick(job: FeedJob): RevealPick {
  const experience = experienceChip(job);
  return {
    id: job.id,
    company: job.company,
    logoUrl: job.logoUrl,
    title: job.title,
    board: boardLabel(job.source),
    place: whereLabel(job).split(",")[0].trim(),
    level: [experience.label, job.salary].filter(Boolean).join(" · ") || null,
    reason: job.reason,
    have: job.skills.have,
    parts: job.breakdown.parts.map((part) => ({ points: part.points, max: part.max })),
    score: job.score,
  };
}

function jobHref(id: string, query: string) {
  return query ? `/jobs/${id}?${query}` : `/jobs/${id}`;
}

/** The after-swipe card: one per right swipe (`key`), its application once /api/swipes answers (`id`), and its outcome. */
type Toast = {
  key: number;
  id: string | null;
  company: string;
  stage: number;
  status: string;
  error: string | null;
  /** Words of our own when the swipe itself failed (no application to explain). */
  detail?: string;
  started: number;
  hideAt: number;
  visible: boolean;
};

/** The toast at a new status; the hide time is set once per status change, so polling never moves it. */
function withStatus(current: Toast, status: string, error: string | null, detail?: string): Toast {
  const meta = statusMeta(status);
  const stage = meta.stage === null ? current.stage : Math.max(current.stage, meta.stage);
  if (status === current.status) return { ...current, stage, error, detail };
  const now = Date.now();
  // Sent: the shell's "Sent to X" toast takes over at once (components/sent-celebration.tsx), so this one leaves now.
  const hideAt = meta.live
    ? current.started + TOAST_LIVE_MAX_MS
    : meta.group === "sent"
      ? now
      : meta.group === "needs"
        ? now + TOAST_AFTER_SENT_MS
        : now + TOAST_AFTER_STOP_MS;
  return { ...current, stage, status, error, detail, hideAt };
}

let toastKeys = 0;

// Jobs swiped since this tab opened. It outlives the deck: a feed page kept in the browser for a minute (staleTimes)
// still lists cards swiped since it was built, and they must not come back.
const swipedThisVisit = new Set<string>();
// The ones applied to: the "jobs you skipped" view leaves these out, and shows the ones skipped on the way.
const appliedThisVisit = new Set<string>();

/** A job applied to or skipped from its own page: the deck drops its card when the feed opens again. */
export function markSwiped(jobId: string, direction: Direction = "left") {
  swipedThisVisit.add(jobId);
  if (direction === "right") appliedThisVisit.add(jobId);
}

/** A swipe from a job's page that was not saved: its card comes back to the deck. */
export function unmarkSwiped(jobId: string) {
  swipedThisVisit.delete(jobId);
  appliedThisVisit.delete(jobId);
}

export function SwipeDeck({
  jobs,
  query,
  view = "new",
  mainHref = "/feed",
  skippedHref = "/feed?view=skipped",
  stats,
  widenFilters,
  daily = null,
}: {
  jobs: FeedJob[];
  query: string;
  /** "skipped": the jobs swiped left, looked at again; a right swipe applies, a left one keeps them skipped. */
  view?: FeedView;
  mainHref?: string;
  skippedHref?: string;
  stats: { sentToday: number; inProgress: number };
  widenFilters: ReactNode;
  /** Today's set (P7): the deck shows its release, offers the next batch, then the end state. Its refill is off. */
  daily?: DailyView | null;
}) {
  // Cards decided this visit stay gone; in the skipped view only the applied ones (a skipped one belongs there).
  const [initial] = useState(() => jobs.filter((job) => !(view === "skipped" ? appliedThisVisit : swipedThisVisit).has(job.id)));
  const [cards, setCards] = useState(initial);
  // The ref is the source of truth so rapid taps or key presses never act on a stale top card.
  const deck = useRef(initial);
  // Cards this deck has already dealt with, so a refill never brings one back. The skipped view keeps its own set,
  // starting from the jobs applied to this visit.
  const seen = useRef(view === "skipped" ? new Set(appliedThisVisit) : swipedThisVisit);
  const refilling = useRef(false);
  // Keys and buttons throw the card through the stage, which commits the swipe when the card is off screen.
  const stage = useRef<SwipeStageHandle>(null);
  const router = useRouter();
  const { refresh: refreshSummary, sentToday, inProgress, waiting } = useApplicationsSummary();

  const [agent, setAgent] = useState<Toast | null>(null);
  // Where the deck is in today's set; null outside it (a filter, the skipped jobs, "Keep going", or no set today).
  const [set, setSet] = useState(daily ? { total: daily.total, released: daily.released, more: daily.more, next: daily.next } : null);
  const [releasing, setReleasing] = useState(false);
  // Today's reveal (Phase R) while unseen: what the agent did, played before the cards. Only in the default view.
  const [reveal, setReveal] = useState(view === "new" && daily?.reveal && initial.length >= 2 ? daily.reveal : null);

  // The deck's own feed address: the page's, until today's set is done and the deck carries on with the rest (rest=1).
  const [feedQuery, setFeedQuery] = useState(query);
  const restQuery = [query, "rest=1"].filter(Boolean).join("&");
  // Past today's set, in place (27 Nov): the rest of the ranked list, fetched in the background while the set's last
  // cards are on screen; empty when nothing more matches, null until asked.
  const [rest, setRest] = useState<FeedJob[] | null>(null);
  const restLoading = useRef(false);
  const [pastSet, setPastSet] = useState(false);

  function setDeck(next: FeedJob[]) {
    deck.current = next;
    setCards(next);
  }

  async function loadRest() {
    if (restLoading.current) return;
    restLoading.current = true;
    try {
      const response = await fetch(`/api/jobs?${restQuery}`, { cache: "no-store" });
      const body = response.ok ? ((await response.json()) as { jobs: FeedJob[] }) : { jobs: [] };
      setRest(body.jobs.filter((job) => !seen.current.has(job.id) && !deck.current.some((card) => card.id === job.id)));
    } catch {
      setRest([]);
    }
  }

  // Today's set with no batch left: fetch what follows it once its last cards are near, and when the set is done carry
  // on with those cards (no reload, no button); nothing more to show keeps the day's end screen.
  const setDone = Boolean(set && !set.more && cards.length === 0);
  useEffect(() => {
    if (set && !set.more && cards.length <= REFILL_BELOW) void loadRest();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadRest guards itself; it runs once per deck
  }, [set, cards.length]);
  useEffect(() => {
    if (!setDone || !rest || rest.length === 0) return;
    const fresh = rest.filter((job) => !seen.current.has(job.id));
    if (fresh.length === 0) return;
    setFeedQuery(restQuery);
    setSet(null);
    setPastSet(true);
    setDeck(fresh);
    setRest(null);
  }, [setDone, rest, restQuery]);

  async function refill() {
    if (refilling.current) return;
    refilling.current = true;
    try {
      const response = await fetch(`/api/jobs?${feedQuery}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { jobs: FeedJob[] };
      const have = new Set(deck.current.map((job) => job.id));
      const fresh = body.jobs.filter((job) => !have.has(job.id) && !seen.current.has(job.id));
      if (fresh.length > 0) setDeck([...deck.current, ...fresh]);
    } catch {
      // The deck still works with what it has; try again on the next swipe.
    } finally {
      refilling.current = false;
    }
  }

  /**
   * "4 more": asks for the next batch from where this deck stands. Another tab or a refresh may have released it
   * already; the server then answers with the current release (409), shown the same way, so no batch is skipped.
   */
  async function releaseNext() {
    if (!set || releasing) return;
    setReleasing(true);
    try {
      const response = await fetch("/api/daily-set", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: set.released }),
      });
      const body = (await response.json().catch(() => ({}))) as { set?: DailyView };
      if (body.set) {
        const next = body.set;
        setSet({ total: next.total, released: next.released, more: next.more, next: next.next });
        setDeck(next.jobs.filter((job) => !seen.current.has(job.id)));
      } else if (response.status === 404) {
        // No set any more (the fields changed and too few jobs fit): the ranked list instead.
        window.location.reload();
      } else {
        toast.error("Couldn't get the next jobs", { description: "Check your connection and try again." });
      }
    } catch {
      toast.error("Couldn't get the next jobs", { description: "Check your connection and try again." });
    } finally {
      setReleasing(false);
    }
  }

  /** Changes this right swipe's toast only; a newer swipe has replaced it otherwise. */
  function updateToast(key: number | null, change: (current: Toast) => Toast) {
    if (key === null) return;
    setAgent((current) => (current && current.key === key ? change(current) : current));
  }

  function putBack(job: FeedJob) {
    seen.current.delete(job.id);
    unmarkSwiped(job.id);
    setDeck([job, ...deck.current.filter((card) => card.id !== job.id)]);
  }

  async function send(job: FeedJob, direction: "left" | "right", toastKey: number | null) {
    const hideToast = () => updateToast(toastKey, (current) => ({ ...current, visible: false }));
    try {
      const response = await fetch("/api/swipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, direction }),
      });
      const body = (await response.json().catch(() => ({}))) as { blocked?: string; error?: string; applicationId?: string };
      if (response.status === 429) {
        // The queue is full. Nothing was saved, so the card goes back on top.
        putBack(job);
        hideToast();
        toast.error("Your agent is busy", { description: "Several applications are still on the way. Swipe again in a minute." });
        return;
      }
      if (response.status === 400 && body.error === "profile_required") {
        putBack(job);
        hideToast();
        toast.error("Finish your profile first", { description: "Your agent needs your resume before it can apply." });
        return;
      }
      if (response.status === 403 && body.blocked) {
        const blocked = body.blocked;
        // Held back by a rule: the toast says so itself, with the application to look at when there is one.
        updateToast(toastKey, (current) => withStatus({ ...current, id: body.applicationId ?? null }, "blocked", blocked));
        return;
      }
      if (response.status === 409 && body.error === "already_swiped") {
        hideToast();
        return;
      }
      if (!response.ok) throw new Error("save failed");
      if (direction === "right" && body.applicationId) {
        const id = body.applicationId;
        updateToast(toastKey, (current) => ({ ...current, id }));
        // The new application counts at once: the end of the set lists it as being filled in.
        refreshSummary();
      }
    } catch {
      // Nothing was saved: put the card back on top so the user can try again.
      putBack(job);
      if (toastKey !== null) updateToast(toastKey, (current) => withStatus(current, "failed", null, "Couldn't save that swipe. It's back on top."));
      else toast.error(`Could not save that swipe for ${job.company}. It is back on top.`);
    }
  }

  function swipe(direction: Direction) {
    const job = deck.current[0];
    if (!job) return;
    seen.current.add(job.id);
    swipedThisVisit.add(job.id);
    if (direction === "right") appliedThisVisit.add(job.id);
    setDeck(deck.current.slice(1));
    let toastKey: number | null = null;
    if (direction === "right") {
      // The toast comes at once ("Getting ready to apply"); the application id joins it when the swipe is saved.
      toastKey = ++toastKeys;
      const started = Date.now();
      setAgent({ key: toastKey, id: null, company: job.company, stage: 0, status: "queued", error: null, started, hideAt: started + TOAST_LIVE_MAX_MS, visible: true });
    }
    // In the skipped view a left swipe keeps the job skipped: there is nothing new to save.
    if (!(view === "skipped" && direction === "left")) void send(job, direction, toastKey);
    // Inside today's set the deck holds just the release: nothing is fetched until "4 more" (what follows the set is
    // fetched by loadRest above).
    if (!set && deck.current.length <= REFILL_BELOW) void refill();
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stage.current?.fling("left");
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        stage.current?.fling("right");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The after-swipe card follows the real application to its outcome: waiting, reading, filling, then sent, needs you
  // or didn't go through. It polls only while the agent is still working and the card is on screen.
  const agentKey = agent?.key ?? null;
  const pollId = agent && agent.visible && statusMeta(agent.status).live ? agent.id : null;
  useEffect(() => {
    if (!pollId) return;
    let stopped = false;
    async function tick() {
      if (stopped) return;
      try {
        const response = await fetch(`/api/applications/${pollId}`, { cache: "no-store" });
        if (stopped || !response.ok) return;
        const body = (await response.json()) as { status: string; error?: string | null };
        setAgent((current) => (current && current.id === pollId ? withStatus(current, body.status, body.error ?? null) : current));
        // Sent: ask the shell now, so its "Sent to X" toast follows this one without waiting for its next poll.
        if (body.status === "submitted") refreshSummary();
      } catch {
        // Keep showing the last stage; the Applications tab has the full story.
      }
    }
    void tick();
    const poll = setInterval(() => void tick(), TOAST_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(poll);
    };
  }, [pollId, refreshSummary]);

  // Hides the card at its hide time; a new status sets a new time and re-arms this.
  const hideAt = agent?.visible ? agent.hideAt : null;
  useEffect(() => {
    if (hideAt === null || agentKey === null) return;
    const key = agentKey;
    const timer = setTimeout(() => {
      setAgent((current) => (current && current.key === key ? { ...current, visible: false } : current));
    }, Math.max(0, hideAt - Date.now()));
    return () => clearTimeout(timer);
  }, [agentKey, hideAt]);

  // The swipe hint (design/daily-reveal.html `teach`): when the cards first show (after the reveal, if one plays), the
  // top card sways towards Apply and Skip so it is clear it can be swiped. Once a day per device; never with reduced
  // motion. Marked in the timer, so a development double run of this effect still plays it once.
  const showingCards = !reveal && cards.length > 0;
  const hinted = useRef(false);
  useEffect(() => {
    if (!showingCards || hinted.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => {
      hinted.current = true;
      const today = new Date().toLocaleDateString("en-CA");
      try {
        if (localStorage.getItem(HINT_KEY) === today) return;
        localStorage.setItem(HINT_KEY, today);
      } catch {
        // Storage blocked: the hint plays once per visit instead.
      }
      stage.current?.nudge();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [showingCards]);

  if (reveal) {
    return (
      <DailyReveal
        picks={cards.map(revealPick)}
        stats={reveal.stats}
        full={reveal.full}
        // Seen once the arc is shown: it does not play again today, on any device. A failed call only replays it once.
        onSeen={() => void fetch("/api/daily-set/reveal", { method: "POST" }).catch(() => undefined)}
        // The deck starts at the card the user brought to the front, the rest in their order after it.
        onOpen={(index) => {
          if (index > 0) setDeck([...deck.current.slice(index), ...deck.current.slice(0, index)]);
          setReveal(null);
        }}
      />
    );
  }

  const top = cards[0];
  const next = cards[1];
  const after = cards[2];

  // The after-swipe card (an application's progress) sits in the slot under the top bar.
  const toastNode = agent ? (
    <div className="fixed inset-x-0 top-[calc(max(12px,env(safe-area-inset-top))+52px)] z-40 mx-auto box-border flex w-full max-w-120 flex-col gap-2 px-4">
      <AgentToast
        company={agent.company}
        stage={agent.stage}
        status={agent.status}
        error={agent.error}
        detail={agent.detail}
        href={agent.id ? `/applications/${agent.id}` : null}
        visible={agent.visible}
        className={agent.visible ? undefined : "absolute inset-x-4 top-0"}
      />
    </div>
  ) : null;

  if (!top && view === "skipped") {
    return (
      <>
        <EmptyState
          art={<DeckDoneArt />}
          title="That's every job you skipped"
          text="Anything you skipped again stays here. New jobs land in your feed through the day."
          actions={
            <Link href={mainHref} className={buttonVariants({ variant: "primary", size: "xl", className: "w-full" })}>
              Back to your feed
            </Link>
          }
        />
        {toastNode}
      </>
    );
  }

  if (!top && set?.more) {
    const count = set.next > 0 ? set.next : 4;
    return (
      <>
        <EmptyState
          art={<DeckDoneArt />}
          title={`${set.released} of today's ${set.total} picks done`}
          text={`${set.total - set.released} more ${set.total - set.released === 1 ? "pick is" : "picks are"} left today.`}
          actions={
            <Button variant="primary" size="xl" className="w-full" disabled={releasing} onClick={() => void releaseNext()}>
              {releasing ? "Loading…" : count === 1 ? "Show the last pick" : `Show next ${count}`}
            </Button>
          }
        />
        {toastNode}
      </>
    );
  }

  if (!top && set) {
    // The set is done and what follows it is still on its way: a moment of the card skeleton, not the end screen.
    if (!set.more && (rest === null || rest.length > 0)) {
      return (
        <>
          <div className="flex flex-1 flex-col justify-center px-5" aria-busy="true" aria-label="Loading more jobs">
            <JobCardSkeleton />
          </div>
          {toastNode}
        </>
      );
    }
    return (
      <>
        <DayDone total={set.total} sent={sentToday ?? stats.sentToday} filling={inProgress ?? stats.inProgress} waiting={waiting?.length ?? 0} />
        {toastNode}
      </>
    );
  }

  if (!top) {
    return (
      <>
        <EmptyState
          art={<DeckDoneArt />}
          title="You're all caught up"
          text="You've seen every match for now. New jobs land through the day, and we'll let you know."
          extra={
            <>
              <SoftChip>{stats.sentToday} sent today</SoftChip>
              <SoftChip>{stats.inProgress} in progress</SoftChip>
            </>
          }
          actions={
            <>
              <Link href="/applications" className={buttonVariants({ variant: "primary", size: "xl", className: "w-full" })}>
                See my applications
              </Link>
              {/* The jobs skipped on the way are the next thing worth a look (owner, 1 Nov). */}
              <Link href={skippedHref} className={buttonVariants({ variant: "line", size: "lg", className: "w-full" })}>
                Look at the jobs you skipped
              </Link>
              {widenFilters}
            </>
          }
        />
        {toastNode}
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-6 px-5 pb-0">
      {/* Capture phase: the card's "See details" link stops the click from bubbling to the stage, not from here. */}
      <div
        className="flex flex-col"
        onClickCapture={(event) => {
          if ((event.target as Element).closest('a[href^="/jobs/"]')) markOpenedFromFeed(top.id);
        }}
      >
        {set ? (
          <p className="m-0 flex h-6 items-center type-meta text-muted-foreground" aria-live="polite">
            {/* Just today's jobs, no counter (owner, 20 Nov: no "1 of 12"). */}
            Today&apos;s jobs
          </p>
        ) : (
          <StackCount total={cards.length} label={view === "skipped" ? "you skipped" : pastSet ? "more that match you" : "in your feed"} />
        )}
        <SwipeStage
          ref={stage}
          top={{ id: top.id, source: top.source, card: cardData(top, feedQuery) }}
          next={next ? { id: next.id, card: cardData(next, feedQuery) } : undefined}
          after={after ? { id: after.id, card: cardData(after, feedQuery) } : undefined}
          onCommit={swipe}
          onOpen={() => {
            markOpenedFromFeed(top.id);
            router.push(jobHref(top.id, feedQuery));
          }}
        />
      </div>
      <p className="m-0 hidden text-center text-xs text-muted-foreground md:block">Use the left and right arrow keys to skip or apply.</p>
      {toastNode}
    </div>
  );
}

/**
 * The end of the day's set (design/daily-reveal.html, the end screen): what happened to the day's jobs, from the
 * shell's live counts, so an application sent while this is on screen moves from "being filled in" to "sent".
 */
function DayDone({ total, sent, filling, waiting }: { total: number; sent: number; filling: number; waiting: number }) {
  // Past today's set (X1): the rest of the ranked list that matches, counted once the day is done, so the end of the set
  // is never a dead end. Null while counting or when the count failed: the button stays hidden.
  const [more, setMore] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/jobs?rest=1")
      .then((response) => (response.ok ? (response.json() as Promise<{ jobs?: unknown[] }>) : null))
      .then((body) => {
        if (live && body?.jobs) setMore(body.jobs.length);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
      <div className="my-auto">
        <h1 className="m-0 type-heading">That&apos;s today&apos;s jobs</h1>
        <p className="m-0 mt-2 type-body text-muted-foreground">New ones tomorrow morning.</p>
        <div className="mt-6 flex flex-col gap-3 border-t border-line pt-6" aria-live="polite">
          {sent > 0 ? (
            <p className="m-0 flex items-center gap-3 type-body">
              <Icon name="check" size={24} className="flex-none" />
              {sent} sent
            </p>
          ) : null}
          {filling > 0 ? (
            <p className="m-0 flex items-center gap-3 type-body">
              <span className="w-6 flex-none">
                <SegmentedProgress count={3} done={2} thickness={4} className="gap-0.5 motion-safe:[&>[data-lit]]:animate-pulse" />
              </span>
              {filling} being filled in
            </p>
          ) : null}
          {waiting > 0 ? (
            <p className="m-0 flex items-center gap-3 type-body">
              <Icon name="info" size={24} className="flex-none" />
              {waiting} {waiting === 1 ? "needs" : "need"} you
            </p>
          ) : null}
          {sent + filling + waiting === 0 ? <p className="m-0 type-body text-muted-foreground">You skipped all {total}.</p> : null}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {more ? (
          <Link href="/feed?rest=1" className={buttonVariants({ variant: "primary", size: "xl", className: "w-full" })}>
            Keep going: {more} more that {more === 1 ? "matches" : "match"} you
          </Link>
        ) : null}
        <Link href="/applications" className={buttonVariants({ variant: more ? "line" : "primary", size: "xl", className: "w-full" })}>
          See applications
        </Link>
      </div>
    </div>
  );
}
