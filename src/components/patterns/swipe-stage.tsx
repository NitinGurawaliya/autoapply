"use client";

import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icons";
import { stampClass } from "@/components/ui/marks";
import { JobCard, type JobCardData } from "@/components/patterns/job-card";
import { swipe as physics, transition } from "@/lib/motion";

export type Direction = "left" | "right";
export type SwipeStageHandle = { fling: (direction: Direction) => void };

/**
 * The swipe deck's look and feel (design/feed.html): the top card follows the finger and tilts, APPLY or SKIP fades
 * in, the next card rises from behind, and the buttons grow toward the side being chosen. A release past the commit
 * distance, a button or `fling()` throws the card off screen and then calls `onCommit`; anything less springs back.
 */
export function SwipeStage({
  top,
  next,
  onCommit,
  ref,
}: {
  top: { id: string; source?: string; card: JobCardData };
  next?: { id: string; card: JobCardData };
  onCommit: (direction: Direction) => void;
  ref?: Ref<SwipeStageHandle>;
}) {
  const x = useMotionValue(0);
  const rotate = useMotionValue(0);
  const leaving = useRef(false);
  const applyOpacity = useTransform(x, [0, physics.commitAt], [0, 1]);
  const skipOpacity = useTransform(x, [-physics.commitAt, 0], [1, 0]);
  const pull = useTransform(x, (value) => Math.min(1, Math.abs(value) / physics.commitAt));
  const backScale = useTransform(pull, (p) => physics.backScale + (1 - physics.backScale) * p);
  const backY = useTransform(pull, (p) => physics.backOffsetY * (1 - p));
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
      <div className="relative mt-[18px] grid">
        {next ? (
          <motion.article key={next.id} aria-hidden="true" style={{ scale: backScale, y: backY }} className="pointer-events-none relative z-[1] [grid-area:1/1]">
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
          className="relative z-[2] cursor-grab touch-none select-none [grid-area:1/1] active:cursor-grabbing"
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
      <div className="flex items-center justify-center gap-8">
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
