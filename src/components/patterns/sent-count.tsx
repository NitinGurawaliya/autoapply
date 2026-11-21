"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useApplicationsSummary } from "@/components/applications-summary";
import { transition } from "@/lib/motion";

/**
 * Today's sent count in the top bar. It starts from the page's own count and follows the shell's poll
 * (components/applications-summary.tsx), so when the agent sends an application the number rolls up: the old one
 * leaves upwards and the new one comes up from below (owner, 21 Nov: "not just render the next number").
 */
export function SentCount({ initial }: { initial: number }) {
  const { sentToday } = useApplicationsSummary();
  const reduced = useReducedMotion();
  const value = sentToday ?? initial;
  return (
    <span className="relative inline-flex overflow-hidden tabular-nums">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          className="inline-block"
          initial={reduced ? { opacity: 0 } : { y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { y: "-100%", opacity: 0 }}
          transition={transition.count}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
