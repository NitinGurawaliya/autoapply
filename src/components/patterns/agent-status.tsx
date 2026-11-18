"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "cn";
import { Icon } from "@/components/ui/icons";
import { ease } from "@/lib/motion";

// The agent at work (24 Oct, owner: "make it feel like the agent is doing everything"): a lime spark that breathes while
// it works, and its words with three thinking dots. Lime is a fill only, behind ink. Still under reduced motion.

/** The agent's mark: a lime disc with the spark, and a soft ring that pulses while it works. */
export function AgentAvatar({ size = 36, active = true, onInverse = false, className }: { size?: number; active?: boolean; onInverse?: boolean; className?: string }) {
  // Ink on the page; paper inside the dark toast (Direction B: the agent is not the accent, which means "act here").
  const fill = onInverse ? "bg-inverse-foreground text-inverse" : "bg-inverse text-inverse-foreground";
  const still = useReducedMotion() || !active;
  return (
    <span aria-hidden="true" data-agent-avatar="" className={cn("relative inline-flex flex-none items-center justify-center", className)} style={{ width: size, height: size }}>
      {still ? null : (
        <motion.span
          className={cn("absolute inset-0 rounded-full", onInverse ? "bg-inverse-foreground" : "bg-inverse")}
          initial={{ scale: 1, opacity: 0.25 }}
          animate={{ scale: 1.7, opacity: 0 }}
          transition={{ duration: 1.6, ease: ease.out, repeat: Infinity }}
        />
      )}
      <motion.span
        className={cn("relative inline-flex size-full items-center justify-center rounded-full", fill)}
        animate={still ? undefined : { scale: [1, 1.06, 1] }}
        transition={still ? undefined : { duration: 1.6, ease: ease.settle, repeat: Infinity }}
      >
        <motion.span
          className="inline-flex"
          animate={still ? undefined : { rotate: [0, 12, 0] }}
          transition={still ? undefined : { duration: 2.4, ease: ease.settle, repeat: Infinity }}
        >
          <Icon name="agent" size={Math.round(size * 0.58)} />
        </motion.span>
      </motion.span>
    </span>
  );
}

/** Three dots that blink in turn after the agent's words while it works. */
function ThinkingDots() {
  const still = useReducedMotion();
  if (still) return <span aria-hidden="true">…</span>;
  return (
    <span aria-hidden="true" className="ml-0.5 inline-flex items-end gap-0.75 pb-0.75">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="size-0.75 rounded-full bg-current"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.2, ease: ease.out, repeat: Infinity, delay: index * 0.2 }}
        />
      ))}
    </span>
  );
}

/**
 * The agent and what it is doing: "Reading the application form…". `active` animates it (the work is going on);
 * finished or waiting states pass false and read as a plain line.
 */
export function AgentStatus({
  text,
  detail,
  active = true,
  size = 36,
  onInverse = false,
  className,
}: {
  text: string;
  detail?: string;
  active?: boolean;
  size?: number;
  /** On an inverse surface (the toast): the avatar flips so it stays visible. */
  onInverse?: boolean;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" data-agent-status="" className={cn("flex items-center gap-3", className)}>
      <AgentAvatar size={size} active={active} onInverse={onInverse} />
      <span className="flex min-w-0 flex-col gap-px">
        <span className="inline-flex items-baseline type-body font-semibold">
          <span className="truncate">{text}</span>
          {active ? <ThinkingDots /> : null}
        </span>
        {detail ? <span className="truncate type-meta opacity-75">{detail}</span> : null}
      </span>
    </div>
  );
}
