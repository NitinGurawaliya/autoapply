"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { SoftChip } from "@/components/ui/chip";
import { EmptyState } from "@/components/patterns/content";
import { DeckDoneArt } from "@/components/patterns/drawings";
import type { JobCardData } from "@/components/patterns/job-card";
import { SwipeStage, type Direction, type SwipeStageHandle } from "@/components/patterns/swipe-stage";
import { AgentToast } from "@/components/patterns/agent-toast";
import { explainOutcome } from "@/lib/explain";
import { statusMeta } from "@/lib/status-meta";
import type { FeedJob } from "@/modules/jobs";

const REFILL_BELOW = 5;
const TOAST_POLL_MS = 1500;
const TOAST_MAX_MS = 8000;
const TOAST_AFTER_SENT_MS = 1600;

const REMOTE_LABEL: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
const STAGE_LABEL: Record<string, string> = { startup: "Startup", midsize: "Mid-size", mnc: "MNC" };

function cardData(job: FeedJob): JobCardData {
  const remote = REMOTE_LABEL[job.remoteType];
  const where = [job.location, remote].filter(Boolean).join(" · ") || "Location not listed";
  const asks = job.requiredYears == null ? null : job.requiredYears <= 0 ? "Entry level" : `Asks ${job.requiredYears}+ yrs`;
  return {
    company: job.company,
    role: job.title,
    posted: job.daysAgo <= 0 ? "Posted today" : `Posted ${job.daysAgo}d ago`,
    why: job.reason,
    where,
    asks,
    hint: job.hint,
    score: job.score,
    tier: job.tier,
    stage: job.stage ? STAGE_LABEL[job.stage] ?? null : null,
    isNew: job.isNew,
    applyUrl: job.applyUrl,
  };
}

type Toast = { id: string; company: string; stage: number; visible: boolean };

// Jobs swiped since this tab opened. It outlives the deck: a feed page kept in the browser for a minute (staleTimes)
// still lists cards swiped since it was built, and they must not come back.
const swipedThisVisit = new Set<string>();

export function SwipeDeck({
  jobs,
  query,
  stats,
  widenFilters,
}: {
  jobs: FeedJob[];
  query: string;
  stats: { sentToday: number; inProgress: number };
  widenFilters: ReactNode;
}) {
  const [initial] = useState(() => jobs.filter((job) => !swipedThisVisit.has(job.id)));
  const [cards, setCards] = useState(initial);
  // The ref is the source of truth so rapid taps or key presses never act on a stale top card.
  const deck = useRef(initial);
  const seen = useRef(swipedThisVisit);
  const refilling = useRef(false);
  // Keys and buttons throw the card through the stage, which commits the swipe when the card is off screen.
  const stage = useRef<SwipeStageHandle>(null);

  const [agent, setAgent] = useState<Toast | null>(null);

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

  async function send(job: FeedJob, direction: "left" | "right") {
    try {
      const response = await fetch("/api/swipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, direction }),
      });
      const body = (await response.json().catch(() => ({}))) as { blocked?: string; error?: string; applicationId?: string };
      if (response.status === 429) {
        // The queue is full. Nothing was saved, so the card goes back on top.
        seen.current.delete(job.id);
        setDeck([job, ...deck.current.filter((card) => card.id !== job.id)]);
        toast.error("Your queue is full", { description: "Wait for a few applications to finish, then swipe again." });
        return;
      }
      if (response.status === 403 && body.blocked) {
        toast.error(`${job.company}: ${explainOutcome("blocked", body.blocked).headline}`, { description: `Rule: ${body.blocked}` });
        return;
      }
      if (response.status === 409 && body.error === "already_swiped") return;
      if (!response.ok) throw new Error("save failed");
      if (direction === "right" && body.applicationId) setAgent({ id: body.applicationId, company: job.company, stage: 0, visible: true });
    } catch {
      // Nothing was saved: put the card back on top so the user can try again.
      seen.current.delete(job.id);
      setDeck([job, ...deck.current.filter((card) => card.id !== job.id)]);
      toast.error(`Could not save that swipe for ${job.company}. It is back on top.`);
    }
  }

  function swipe(direction: Direction) {
    const job = deck.current[0];
    if (!job) return;
    seen.current.add(job.id);
    setDeck(deck.current.slice(1));
    void send(job, direction);
    if (deck.current.length <= REFILL_BELOW) void refill();
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

  // The after-swipe card follows the real application: waiting, reading, filling, submitted.
  const agentId = agent?.id;
  useEffect(() => {
    if (!agentId) return;
    let stopped = false;
    const started = Date.now();
    let hideAt = started + TOAST_MAX_MS;
    async function tick() {
      if (stopped) return;
      try {
        const response = await fetch(`/api/applications/${agentId}`, { cache: "no-store" });
        if (response.ok) {
          const body = (await response.json()) as { status: string };
          const stage = statusMeta(body.status).stage;
          if (stage !== null) setAgent((current) => (current && current.id === agentId ? { ...current, stage: Math.max(current.stage, stage) } : current));
          if (body.status === "submitted") hideAt = Math.min(hideAt, Date.now() + TOAST_AFTER_SENT_MS);
        }
      } catch {
        // Keep showing the last stage; the Applications tab has the full story.
      }
    }
    void tick();
    const poll = setInterval(() => void tick(), TOAST_POLL_MS);
    const hide = setInterval(() => {
      if (Date.now() >= hideAt) setAgent((current) => (current && current.id === agentId ? { ...current, visible: false } : current));
    }, 200);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(hide);
    };
  }, [agentId]);

  const top = cards[0];
  const next = cards[1];

  const toastNode = agent ? (
    <div className="fixed inset-x-0 top-[calc(max(12px,env(safe-area-inset-top))+52px)] z-40 mx-auto box-border w-full max-w-[480px] px-4">
      <AgentToast company={agent.company} stage={agent.stage} href={`/applications/${agent.id}`} visible={agent.visible} />
    </div>
  ) : null;

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
              {widenFilters}
            </>
          }
        />
        {toastNode}
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-6 px-5 pb-2">
      <SwipeStage
        ref={stage}
        top={{ id: top.id, source: top.source, card: cardData(top) }}
        next={next ? { id: next.id, card: cardData(next) } : undefined}
        onCommit={swipe}
      />
      <p className="m-0 hidden text-center text-xs text-muted-foreground md:block">Use the left and right arrow keys to skip or apply.</p>
      {toastNode}
    </div>
  );
}
