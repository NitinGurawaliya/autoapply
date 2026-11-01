"use client";

import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icons";
import { BoardMark, stampClass } from "@/components/ui/marks";
import { CARD_HEIGHT, JobCard, type JobCardData } from "@/components/patterns/job-card";
import { swipe as physics, transition } from "@/lib/motion";

export type Direction = "left" | "right";
export type SwipeStageHandle = { fling: (direction: Direction) => void };

/** How far each card behind the top one shows below it, so the stack reads as more jobs waiting. */
const PEEK = physics.backOffsetY;

/** Over the deck: how many jobs are waiting and how many came from each board ("Greenhouse 24", "Lever 12"). */
export function StackCount({ total, boards }: { total: number; boards: Array<[board: string, count: number]> }) {
  return (
    <div className="flex h-6 items-center justify-between gap-3 text-sm" aria-live="polite">
      <span className="font-semibold">
        {total} {total === 1 ? "job" : "jobs"} for you
      </span>
      <span className="flex min-w-0 items-center gap-3 overflow-hidden text-muted-foreground">
        {boards.map(([board, count]) => (
          <span key={board} className="flex flex-none items-center gap-1.5" title={`${count} from ${board}`}>
            <BoardMark board={board} className="text-foreground" />
            <span className="sr-only">{board}</span>
            <span className="font-semibold tabular-nums">{count}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * The swipe deck's look and feel (design/feed.html): the top card follows the finger and tilts, APPLY or SKIP fades
 * in, the next card rises from behind, and the buttons grow toward the side being chosen. A release past the commit
 * distance, a button or `fling()` throws the card off screen and then calls `onCommit`; anything less springs back.
 * Two cards show their bottom edge under the top one; a tap (no drag) on the top card calls `onOpen`.
 */
export function SwipeStage({
  top,
  next,
  after,
  onCommit,
  onOpen,
  ref,
}: {
  top: { id: string; source?: string; card: JobCardData };
  next?: { id: string; card: JobCardData };
  /** The card under `next`: only its edge shows. */
  after?: { id: string; card: JobCardData };
  onCommit: (direction: Direction) => void;
  onOpen?: () => void;
  ref?: Ref<SwipeStageHandle>;
}) {
  const x = useMotionValue(0);
  const rotate = useMotionValue(0);
  const leaving = useRef(false);
  // Set once the pointer drags, so letting go after a drag is not also a tap that opens the job.
  const dragged = useRef(false);
  const applyOpacity = useTransform(x, [0, physics.commitAt], [0, 1]);
  const skipOpacity = useTransform(x, [-physics.commitAt, 0], [1, 0]);
  const pull = useTransform(x, (value) => Math.min(1, Math.abs(value) / physics.commitAt));
  const backScale = useTransform(pull, (p) => physics.backScale + (1 - physics.backScale) * p);
  const backY = useTransform(pull, (p) => PEEK * (1 - p));
  const afterScale = useTransform(pull, (p) => 2 * physics.backScale - 1 + (1 - physics.backScale) * p);
  const afterY = useTransform(pull, (p) => PEEK * (2 - p));
  const skipScale = useTransform(x, (value) => 1 + physics.buttonGrow * Math.max(0, Math.min(1, -value / physics.commitAt)));
  const applyScale = useTransform(x, (value) => 1 + physics.buttonGrow * Math.max(0, Math.min(1, value / physics.commitAt)));

  function fling(direction: Direction) {
    if (leaving.current) return;
    leaving.current = true;
    const sign = direction === "right" ? 1 : -1;
    void animate(rotate, sign * physics.exitRotate, transition.cardExit);
    void animate(x, sign * physics.exitDistance, transition.cardExit).then(() => onCommit(direction));
  }

  // A new top card starts at rest (reset after it mounts, so the thrown card never flashes back to the centre).
  useLayoutEffect(() => {
    x.set(0);
    rotate.set(0);
    leaving.current = false;
  }, [top.id, x, rotate]);

  useImperativeHandle(ref, () => ({ fling }));

  return (
    <>
      <div className="relative mt-[18px] grid grid-cols-[minmax(0,1fr)]" style={{ paddingBottom: 2 * PEEK }}>
        {after ? (
          <motion.article
            key={after.id}
            aria-hidden="true"
            style={{ scale: afterScale, y: afterY }}
            className={`pointer-events-none relative z-0 origin-bottom [grid-area:1/1] ${CARD_HEIGHT}`}
          >
            <JobCard job={after.card} />
          </motion.article>
        ) : null}
        {next ? (
          <motion.article
            key={next.id}
            aria-hidden="true"
            style={{ scale: backScale, y: backY }}
            className={`pointer-events-none relative z-[1] origin-bottom [grid-area:1/1] ${CARD_HEIGHT}`}
          >
            <JobCard job={next.card} />
          </motion.article>
        ) : null}
        <motion.article
          key={top.id}
          data-job-id={top.id}
          data-source={top.source}
          drag="x"
          dragSnapToOrigin={false}
          dragMomentum={false}
          style={{ x, rotate }}
          onPointerDown={() => {
            dragged.current = false;
          }}
          onDragStart={() => {
            dragged.current = true;
          }}
          onClick={() => {
            if (!dragged.current && !leaving.current) onOpen?.();
          }}
          onDrag={() => rotate.set(x.get() * physics.rotatePerPx)}
          onDragEnd={() => {
            const offset = x.get();
            if (offset > physics.commitAt) fling("right");
            else if (offset < -physics.commitAt) fling("left");
            else {
              void animate(x, 0, transition.cardReturn);
              void animate(rotate, 0, transition.cardReturn);
            }
          }}
          className={`relative z-[2] cursor-grab touch-none select-none [grid-area:1/1] active:cursor-grabbing ${CARD_HEIGHT}`}
        >
          <JobCard
            job={top.card}
            stamps={
              <>
                <motion.span aria-hidden="true" style={{ opacity: applyOpacity }} className={stampClass("apply")}>
                  APPLY
                </motion.span>
                <motion.span aria-hidden="true" style={{ opacity: skipOpacity }} className={stampClass("skip")}>
                  SKIP
                </motion.span>
              </>
            }
          />
        </motion.article>
      </div>
      {/* Always above the tab bar, like the job page's action bar: on a short phone (375x667) the stack is taller
          than the space left, and the buttons stay on screen over its bottom edge. */}
      <div className="sticky bottom-[calc(82px+max(0px,env(safe-area-inset-bottom)-24px))] z-10 mt-3 flex items-center justify-center gap-8 bg-background pt-3 pb-2">
        <motion.div style={{ scale: skipScale }}>
          <IconButton variant="skip" size="skip" aria-label="Skip" onClick={() => fling("left")}>
            <Icon name="close" size={26} strokeWidth={2.25} />
          </IconButton>
        </motion.div>
        <motion.div style={{ scale: applyScale }}>
          <IconButton variant="apply" size="apply" aria-label="Apply" onClick={() => fling("right")}>
            <Icon name="check" size={30} strokeWidth={2.5} />
          </IconButton>
        </motion.div>
      </div>
    </>
  );
}
