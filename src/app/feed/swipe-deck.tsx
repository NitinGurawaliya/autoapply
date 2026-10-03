"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { daysAgoLabel } from "@/lib/days";

type FeedJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  applyUrl: string;
  score: number;
  daysAgo: number;
  reason: string;
};

export function SwipeDeck({ jobs }: { jobs: FeedJob[] }) {
  const [cards, setCards] = useState(jobs);
  const [busy, setBusy] = useState(false);
  const top = cards[0];
  const swipeRef = useRef<(direction: "left" | "right") => void>(() => {});

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
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

  async function swipe(direction: "left" | "right") {
    if (!top || busy) return;
    setBusy(true);
    const response = await fetch("/api/swipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: top.id, direction }),
    });
    const body = (await response.json().catch(() => ({}))) as { blocked?: string; error?: string };
    if (response.status === 403 && body.blocked) {
      toast.error(`Blocked by rule: ${body.blocked}`);
      setCards((current) => current.slice(1));
      setBusy(false);
      return;
    }
    if (response.status === 409 && body.error === "already_swiped") {
      setCards((current) => current.slice(1));
      setBusy(false);
      return;
    }
    if (!response.ok) {
      toast.error("Could not save that swipe.");
      setBusy(false);
      return;
    }
    toast.success(direction === "right" ? "Queued to apply" : "Skipped");
    setCards((current) => current.slice(1));
    setBusy(false);
  }

  useEffect(() => {
    swipeRef.current = (direction) => {
      void swipe(direction);
    };
  });

  if (!top) {
    return (
      <p className="rounded-lg border border-border px-3 py-6 text-sm text-muted-foreground">
        No jobs left in this stack.
      </p>
    );
  }

  const behind = cards.slice(1, 3);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative h-[280px]">
        {behind
          .slice()
          .reverse()
          .map((job, index) => (
            <div
              key={job.id}
              className="absolute inset-x-3 top-3 rounded-lg border border-border bg-card p-4"
              style={{ transform: `translateY(${(behind.length - index) * 8}px) scale(${1 - (behind.length - index) * 0.03})` }}
            />
          ))}
        <SwipeCard key={top.id} job={top} disabled={busy} onSwipe={swipe} />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={() => void swipe("left")}>
          Skip
        </Button>
        <Button type="button" className="flex-1" disabled={busy} onClick={() => void swipe("right")}>
          Apply
        </Button>
      </div>
    </div>
  );
}

function SwipeCard({
  job,
  disabled,
  onSwipe,
}: {
  job: FeedJob;
  disabled: boolean;
  onSwipe: (direction: "left" | "right") => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-180, 180], [-12, 12]);

  return (
    <motion.article
      data-job-id={job.id}
      data-source={job.source}
      drag={disabled ? false : "x"}
      dragConstraints={{ left: -240, right: 240 }}
      style={{ x, rotate }}
      onDragEnd={(_, info) => {
        if (info.offset.x > 120) onSwipe("right");
        else if (info.offset.x < -120) onSwipe("left");
        else void animate(x, 0);
      }}
      className="absolute inset-0 flex cursor-grab flex-col gap-1 rounded-lg border border-border bg-card p-4 active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold">{job.title}</h2>
        <Badge>{job.score}%</Badge>
      </div>
      <p className="text-sm">{job.company}</p>
      <p className="text-sm text-muted-foreground">{job.location}</p>
      <p className="text-sm text-muted-foreground">{daysAgoLabel(job.daysAgo)}</p>
      <p className="line-clamp-2 text-sm">{job.reason}</p>
      <a
        href={job.applyUrl}
        target="_blank"
        rel="noopener noreferrer"
        onPointerDown={(event) => event.stopPropagation()}
        className="mt-auto inline-flex items-center gap-1 self-start text-sm font-medium underline underline-offset-4"
      >
        View job
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </motion.article>
  );
}
