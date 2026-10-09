"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { Check, Clock, ExternalLink, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { CompanyAvatar } from "@/components/company-avatar";
import { Button } from "@/components/ui/button";
import { daysAgoLabel } from "@/lib/days";
import type { FeedJob } from "@/modules/jobs";

const REFILL_BELOW = 5;

export function SwipeDeck({ jobs, query }: { jobs: FeedJob[]; query: string }) {
  const [cards, setCards] = useState(jobs);
  // The ref is the source of truth so rapid taps or key presses never act on a stale top card.
  const deck = useRef(jobs);
  const seen = useRef(new Set<string>());
  const refilling = useRef(false);
  const top = cards[0];
  const swipeRef = useRef<(direction: "left" | "right") => void>(() => {});

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
      const body = (await response.json().catch(() => ({}))) as { blocked?: string; error?: string };
      if (response.status === 429) {
        // The queue is full. Nothing was saved, so the card goes back on top.
        seen.current.delete(job.id);
        setDeck([job, ...deck.current.filter((card) => card.id !== job.id)]);
        toast.error("Your queue is full", { description: "Wait for a few applications to finish, then swipe again." });
        return;
      }
      if (response.status === 403 && body.blocked) {
        toast.error(`${job.company}: blocked by rule ${body.blocked}`);
        return;
      }
      if (response.status === 409 && body.error === "already_swiped") return;
      if (!response.ok) throw new Error("save failed");
      if (direction === "right") toast.success(`Applying to ${job.company}`, { description: "Track it under Applications." });
    } catch {
      // Nothing was saved: put the card back on top so the user can try again.
      seen.current.delete(job.id);
      setDeck([job, ...deck.current.filter((card) => card.id !== job.id)]);
      toast.error(`Could not save that swipe for ${job.company}. It is back on top.`);
    }
  }

  function swipe(direction: "left" | "right") {
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
        swipeRef.current("left");
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        swipeRef.current("right");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    swipeRef.current = swipe;
  });

  if (!top) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-card">
        <span className="grid size-12 place-items-center rounded-full bg-success-soft text-success">
          <Check className="size-6" aria-hidden />
        </span>
        <h2 className="text-base font-semibold">You are all caught up</h2>
        <p className="max-w-[28ch] text-sm text-muted-foreground">No more jobs match right now. New ones arrive as companies post them.</p>
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <Link href="/applications" className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            See your applications
          </Link>
          <Link href="/feed" className="rounded-full border border-border px-4 py-2 text-sm">
            Reset filters
          </Link>
        </div>
      </div>
    );
  }

  const behind = cards.slice(1, 3);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative h-[372px]">
        {behind
          .slice()
          .reverse()
          .map((job, index) => (
            <div
              key={job.id}
              className="absolute inset-x-3 top-3 h-full rounded-2xl border border-border bg-card shadow-card"
              style={{ transform: `translateY(${(behind.length - index) * 8}px) scale(${1 - (behind.length - index) * 0.03})` }}
            />
          ))}
        <SwipeCard key={top.id} job={top} onSwipe={swipe} />
      </div>
      <div className="flex gap-3">
        <Button type="button" variant="outline" size="lg" className="h-12 flex-1 gap-2 text-base" onClick={() => swipe("left")}>
          <X className="size-5" aria-hidden />
          Skip
        </Button>
        <Button type="button" size="lg" className="h-12 flex-1 gap-2 text-base" onClick={() => swipe("right")}>
          <Check className="size-5" aria-hidden />
          Apply
        </Button>
      </div>
      <p className="hidden text-center text-xs text-muted-foreground md:block">Use the left and right arrow keys to skip or apply.</p>
    </div>
  );
}

/** Match score as a ring: green from 70, brand colour from 50, amber below. */
function MatchRing({ score }: { score: number }) {
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const tone = score >= 70 ? "text-success" : score >= 50 ? "text-primary" : "text-warning";
  return (
    <div className="relative grid size-12 shrink-0 place-items-center" role="img" aria-label={`Match score ${score} percent`}>
      <svg viewBox="0 0 44 44" className="size-12 -rotate-90">
        <circle cx="22" cy="22" r={radius} fill="none" strokeWidth="4" className="stroke-muted" />
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, score)) / 100)}
          className={`stroke-current ${tone}`}
        />
      </svg>
      <span className={`absolute text-[11px] font-semibold ${tone}`}>{score}%</span>
    </div>
  );
}

const REMOTE_LABEL: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };

function experienceTag(years: number | null) {
  if (years == null) return null;
  return years <= 0 ? "Entry level" : `${years}+ yrs asked`;
}

function Tag({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "brand" | "success" | "warning" }) {
  const style =
    tone === "brand"
      ? "bg-accent text-accent-foreground"
      : tone === "success"
        ? "bg-success-soft text-success"
        : tone === "warning"
          ? "bg-warning-soft text-warning"
          : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>{children}</span>;
}

function SwipeCard({ job, onSwipe }: { job: FeedJob; onSwipe: (direction: "left" | "right") => void }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-180, 180], [-10, 10]);
  // Colour builds as the card is dragged: green toward apply, grey toward skip.
  const applyOpacity = useTransform(x, [24, 130], [0, 1]);
  const skipOpacity = useTransform(x, [-130, -24], [1, 0]);
  const experience = experienceTag(job.requiredYears);

  return (
    <motion.article
      data-job-id={job.id}
      data-source={job.source}
      drag="x"
      dragConstraints={{ left: -240, right: 240 }}
      style={{ x, rotate }}
      onDragEnd={(_, info) => {
        if (info.offset.x > 120) onSwipe("right");
        else if (info.offset.x < -120) onSwipe("left");
        else void animate(x, 0);
      }}
      className="absolute inset-0 flex cursor-grab flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-card active:cursor-grabbing"
    >
      <motion.div aria-hidden style={{ opacity: applyOpacity }} className="pointer-events-none absolute inset-0 bg-success-soft/70" />
      <motion.div aria-hidden style={{ opacity: skipOpacity }} className="pointer-events-none absolute inset-0 bg-muted/80" />
      <motion.span
        aria-hidden
        style={{ opacity: applyOpacity }}
        className="pointer-events-none absolute left-1/2 top-[76%] -translate-x-1/2 -translate-y-1/2 -rotate-6 rounded-xl border-4 border-success bg-card/80 px-5 py-2 text-2xl font-extrabold tracking-widest text-success"
      >
        APPLY
      </motion.span>
      <motion.span
        aria-hidden
        style={{ opacity: skipOpacity }}
        className="pointer-events-none absolute left-1/2 top-[76%] -translate-x-1/2 -translate-y-1/2 rotate-6 rounded-xl border-4 border-muted-foreground bg-card/80 px-5 py-2 text-2xl font-extrabold tracking-widest text-muted-foreground"
      >
        SKIP
      </motion.span>

      <div className="relative flex items-start gap-3">
        <CompanyAvatar name={job.company} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-snug">{job.title}</h2>
          <p className="truncate text-sm text-muted-foreground">{job.company}</p>
        </div>
        <MatchRing score={job.score} />
      </div>

      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-4" aria-hidden />
          {job.location || "Location not listed"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-4" aria-hidden />
          {daysAgoLabel(job.daysAgo)}
        </span>
      </div>

      <div className="relative flex flex-wrap gap-2">
        {REMOTE_LABEL[job.remoteType] ? <Tag>{REMOTE_LABEL[job.remoteType]}</Tag> : null}
        {experience ? <Tag tone={job.requiredYears === 0 ? "success" : "muted"}>{experience}</Tag> : null}
        {job.hint ? <Tag tone="warning">{job.hint}</Tag> : null}
        {job.skillHits.map((skill) => (
          <Tag key={skill} tone="brand">
            {skill}
          </Tag>
        ))}
      </div>

      <p className="relative line-clamp-2 text-sm">{job.reason}</p>

      <a
        href={job.applyUrl}
        target="_blank"
        rel="noopener noreferrer"
        onPointerDown={(event) => event.stopPropagation()}
        className="relative mt-auto inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        View job
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </motion.article>
  );
}
