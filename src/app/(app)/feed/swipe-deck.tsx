"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { SoftChip } from "@/components/ui/chip";
import { EmptyState } from "@/components/patterns/content";
import { DeckDoneArt } from "@/components/patterns/drawings";
import type { JobCardData } from "@/components/patterns/job-card";
import { StackCount, SwipeStage, type Direction, type SwipeStageHandle } from "@/components/patterns/swipe-stage";
import { AgentToast } from "@/components/patterns/agent-toast";
import { SkipReasonToast, type SkipAsk, type SkipReasonValue, type SkipToastStep } from "@/components/patterns/skip-reason-toast";
import { useApplicationsSummary } from "@/components/applications-summary";
import { boardLabel } from "@/lib/board-label";
import { experienceChip, postedLabel, STAGE_LABEL, whereLabel } from "@/lib/job-facts";
import { statusMeta } from "@/lib/status-meta";
import type { DailyView, FeedJob, FeedView } from "@/modules/jobs";
import { markOpenedFromFeed } from "../jobs/[id]/feed-back-link";

const REFILL_BELOW = 5;
const TOAST_POLL_MS = 1500;
// While the agent works the toast stays (a mock run takes ~30 s, a wait in the queue can be longer); a new right swipe
// replaces it. Once the outcome is in: sent and needs-you go quickly (the needs-you sheet opens by itself), a
// didn't-go-through stays long enough to read why.
const TOAST_LIVE_MAX_MS = 60_000;
const TOAST_AFTER_SENT_MS = 1600;
const TOAST_AFTER_STOP_MS = 4000;
// The "Why?" card after a left swipe (P8): 4 s to tap a reason, then "Noted" briefly; a question from the skips stays
// until it is answered or the next swipe replaces it.
const WHY_MS = 4000;
const NOTED_MS = 1400;
// After a "Not my field" was saved with nothing to ask: "Noted" has been up while it saved.
const NOTED_AFTER_MS = 500;
const DONE_MS = 2600;
const WHY_AFTER_HOLD_MS = 1500;

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

/** The "Why?" card (P8): one per left swipe (`key`), the job it asks about, its step, and when it hides (null: stays). */
type Why = { key: number; jobId: string; company: string; state: SkipToastStep; visible: boolean; hideAt: number | null };

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
  const { refresh: refreshSummary } = useApplicationsSummary();

  const [agent, setAgent] = useState<Toast | null>(null);
  // Where the deck is in today's set; null outside it (a filter, the skipped jobs, "Keep going", or no set today).
  const [set, setSet] = useState(daily ? { total: daily.total, released: daily.released, more: daily.more, next: daily.next } : null);
  const [releasing, setReleasing] = useState(false);
  const [why, setWhy] = useState<Why | null>(null);
  // A pointer or keyboard focus on the "Why?" card holds its timer.
  const [whyHeld, setWhyHeld] = useState(false);

  function setDeck(next: FeedJob[]) {
    deck.current = next;
    setCards(next);
  }

  async function refill() {
    if (refilling.current) return;
    refilling.current = true;
    try {
      const response = await fetch(`/api/jobs?${query}`, { cache: "no-store" });
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

  /** Changes this left swipe's "Why?" card only; a newer swipe has replaced it otherwise. */
  function updateWhy(key: number, change: (current: Why) => Why) {
    setWhy((current) => (current && current.key === key ? change(current) : current));
  }

  /** A reason tapped: saved on the left swipe (it may land before the swipe itself); the skips may answer with a question. */
  async function giveReason(reason: SkipReasonValue) {
    if (!why || why.state.step !== "why") return;
    const { key, jobId } = why;
    // "Not my field" may bring a question back (the server counts the skips first): "Noted" stays until it answers, so
    // the card never fades out and back in. Other reasons rarely do: "Noted" goes after a moment.
    const waits = reason === "not_my_field";
    updateWhy(key, (current) => ({ ...current, state: { step: "noted", text: "Noted" }, hideAt: waits ? null : Date.now() + NOTED_MS }));
    try {
      const response = await fetch(`/api/swipes/${encodeURIComponent(jobId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = (await response.json().catch(() => ({}))) as { ask?: SkipAsk | null };
      const ask = response.ok ? body.ask : null;
      if (ask) updateWhy(key, (current) => ({ ...current, visible: true, state: { step: "ask", ask, busy: false }, hideAt: null }));
      else if (waits) updateWhy(key, (current) => ({ ...current, hideAt: Date.now() + NOTED_AFTER_MS }));
    } catch {
      // A reason is a hint, not a step: the swipe itself is saved by its own request.
      if (waits) updateWhy(key, (current) => ({ ...current, visible: false }));
    }
  }

  /** Yes or No to the question from the skips. Yes on "Change your fields?" opens the confirm screen. */
  async function answerAsk(yes: boolean) {
    if (!why || why.state.step !== "ask") return;
    const { key } = why;
    const ask = why.state.ask;
    updateWhy(key, (current) => ({ ...current, state: { step: "ask", ask, busy: true } }));
    try {
      const response = await fetch("/api/brief/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family: ask.family, yes }),
      });
      if (!response.ok && response.status !== 404) throw new Error("save failed");
      if (yes && ask.type === "change_fields") {
        updateWhy(key, (current) => ({ ...current, visible: false }));
        router.push("/onboarding/confirm");
        return;
      }
      if (yes && ask.done) {
        updateWhy(key, (current) => ({ ...current, state: { step: "noted", text: ask.done }, hideAt: Date.now() + DONE_MS }));
        // The cards of that field still in the deck go now; the feed is rebuilt without them.
        if (ask.type === "stop_track") {
          setDeck(deck.current.filter((card) => card.track !== ask.family));
          if (!set && deck.current.length <= REFILL_BELOW) void refill();
        }
        return;
      }
      updateWhy(key, (current) => ({ ...current, visible: false }));
    } catch {
      updateWhy(key, (current) => ({ ...current, state: { step: "ask", ask, busy: false } }));
      toast.error("Couldn't save that", { description: "Check your connection and try again." });
    }
  }

  function putBack(job: FeedJob) {
    // The card is back on top: nothing to ask about it.
    setWhy((current) => (current && current.jobId === job.id ? { ...current, visible: false } : current));
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
    if (direction === "left" && view !== "skipped") {
      setWhyHeld(false);
      setWhy({ key: ++toastKeys, jobId: job.id, company: job.company, state: { step: "why" }, visible: true, hideAt: Date.now() + WHY_MS });
    } else {
      setWhy((current) => (current ? { ...current, visible: false } : current));
    }
    // Inside today's set the deck holds just the release: nothing is fetched until "4 more".
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

  // Hides the "Why?" card at its hide time, unless a pointer or focus holds it.
  const whyKey = why?.key ?? null;
  const whyHideAt = why?.visible && !whyHeld ? why.hideAt : null;
  useEffect(() => {
    if (whyHideAt === null || whyKey === null) return;
    const key = whyKey;
    const timer = setTimeout(() => {
      setWhy((current) => (current && current.key === key ? { ...current, visible: false } : current));
    }, Math.max(0, whyHideAt - Date.now()));
    return () => clearTimeout(timer);
  }, [whyKey, whyHideAt]);

  function holdWhy(held: boolean) {
    setWhyHeld(held);
    // Let go after the time ran out: a moment more to read it, never an instant vanish.
    if (!held) setWhy((current) => (current && current.hideAt !== null ? { ...current, hideAt: Math.max(current.hideAt, Date.now() + WHY_AFTER_HOLD_MS) } : current));
  }

  const top = cards[0];
  const next = cards[1];
  const after = cards[2];

  // The after-swipe cards share the slot under the top bar: the agent's on top, the "Why?" card under it. A hidden one
  // leaves the flow (absolute) as it fades, so the other never sits below an empty space.
  const toastNode = agent || why ? (
    <div className="fixed inset-x-0 top-[calc(max(12px,env(safe-area-inset-top))+52px)] z-40 mx-auto box-border flex w-full max-w-120 flex-col gap-2 px-4">
      {agent ? (
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
      ) : null}
      {why ? (
        <SkipReasonToast
          company={why.company}
          state={why.state}
          visible={why.visible}
          onReason={(reason) => void giveReason(reason)}
          onAnswer={(yes) => void answerAsk(yes)}
          onHold={holdWhy}
          className={why.visible ? undefined : "absolute inset-x-4 top-0"}
        />
      ) : null}
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
    return (
      <>
        <EmptyState
          art={<DeckDoneArt />}
          title={`That's all ${set.total} for today`}
          text="A new set comes tomorrow morning. Until then, the rest of your matches are a tap away."
          extra={
            <>
              <SoftChip>{stats.sentToday} sent today</SoftChip>
              <SoftChip>{stats.inProgress} in progress</SoftChip>
            </>
          }
          actions={
            <>
              <Link href="/applications" className={buttonVariants({ variant: "primary", size: "xl", className: "w-full" })}>
                Done for today
              </Link>
              {/* The ranked list after the set, with the deck's refill on (/feed?rest=1). */}
              <Link href="/feed?rest=1" className={buttonVariants({ variant: "line", size: "lg", className: "w-full" })}>
                Keep going
              </Link>
            </>
          }
        />
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
            Pick {Math.min(set.total, Math.max(1, set.released - cards.length + 1))} of today&apos;s {set.total}
          </p>
        ) : (
          <StackCount total={cards.length} label={view === "skipped" ? "you skipped" : "in your feed"} />
        )}
        <SwipeStage
          ref={stage}
          top={{ id: top.id, source: top.source, card: cardData(top, query) }}
          next={next ? { id: next.id, card: cardData(next, query) } : undefined}
          after={after ? { id: after.id, card: cardData(after, query) } : undefined}
          onCommit={swipe}
          onOpen={() => {
            markOpenedFromFeed(top.id);
            router.push(jobHref(top.id, query));
          }}
        />
      </div>
      <p className="m-0 hidden text-center text-xs text-muted-foreground md:block">Use the left and right arrow keys to skip or apply.</p>
      {toastNode}
    </div>
  );
}
