"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "framer-motion";
import { Icon } from "@/components/ui/icons";
import { useApplicationsSummary, type SentNews } from "@/components/applications-summary";

// How long the toast stays before it slides away on its own; a finger or pointer on it holds it.
const SHOW_MS = 4500;

// A small burst around the disc, in the app's own colours (lime, the light ink on the dark card).
type Piece = { x: number; y: number; rotate: number; size: number; round: boolean; tone: string; delay: number };
function burst(count: number): Piece[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const distance = 26 + Math.random() * 26;
    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      rotate: (Math.random() - 0.5) * 360,
      size: 4 + Math.round(Math.random() * 3),
      round: index % 2 === 0,
      tone: index % 3 === 0 ? "bg-inverse-foreground" : "bg-primary",
      delay: 0.12 + Math.random() * 0.08,
    };
  });
}

/** The line under "Sent to X": a first, a round number, this week's count, or else the role. */
function progressLine(news: SentNews): string {
  const total = news.sentTotal;
  if (total === 1) return "Your first application is out";
  if (total && [5, 10, 25, 50, 75, 100, 150, 200, 300, 500].includes(total)) return `${total} applications sent`;
  if (news.sent.length === 1 && news.sentThisWeek && news.sentThisWeek > 1) return `${news.sent[0].title} · ${news.sentThisWeek} this week`;
  return news.sent[0]?.title ?? "";
}

function listCompanies(names: string[]) {
  const unique = [...new Set(names)];
  if (unique.length <= 2) return unique.join(" and ");
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

/**
 * The "Sent!" moment (owner, 1 Nov: an application going out is the big moment, but it must never stop what the user
 * is doing). A dark toast drops in at the top, like the after-swipe toast: a lime disc pops in with an ink check, a
 * small burst and a ring flare around it, "Sent to Stripe" and a line that turns the count into progress. No scrim, no
 * focus taken, nothing under it blocked; it slides away by itself, a tap opens the application, a flick up dismisses it.
 * Under reduced motion it simply fades.
 */
export function SentToast({ news, onDone, onOpen }: { news: SentNews; onDone: () => void; onOpen: () => void }) {
  const still = useReducedMotion();
  const [pieces] = useState(() => burst(14));
  const [held, setHeld] = useState(false);
  const many = news.sent.length > 1;
  const first = news.sent[0];
  const title = many ? `${news.sent.length} applications sent` : `Sent to ${first.company}`;
  const line = many ? `To ${listCompanies(news.sent.map((item) => item.company))}` : progressLine(news);

  // A short buzz on a phone that can; nothing else moves or takes focus.
  useEffect(() => {
    if (still) return;
    try {
      navigator.vibrate?.([18, 40, 28]);
    } catch {
      // No vibration on this device.
    }
  }, [still]);

  // Slides away on its own unless a finger or pointer rests on it.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  // A flick up that dismisses it is not also a tap that opens the application.
  const flicked = useRef(false);
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => done.current(), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [held]);

  const pop = still ? { duration: 0.2 } : { type: "spring" as const, stiffness: 460, damping: 14 };

  return (
    <motion.div
      role="status"
      aria-live="polite"
      data-sent-toast=""
      className="pointer-events-auto relative box-border flex cursor-pointer touch-pan-x items-center gap-3 rounded-panel bg-inverse px-3.5 py-3 text-inverse-foreground shadow-float select-none"
      initial={still ? { opacity: 0 } : { opacity: 0, y: -28, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={still ? { opacity: 0 } : { opacity: 0, y: -24, scale: 0.96, transition: { duration: 0.22 } }}
      transition={still ? { duration: 0.2 } : { type: "spring", stiffness: 380, damping: 26 }}
      drag={still ? false : "y"}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.6, bottom: 0.1 }}
      onDragStart={() => {
        flicked.current = true;
      }}
      onDragEnd={(_, info: PanInfo) => {
        if (info.offset.y < -24 || info.velocity.y < -300) onDone();
      }}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onTouchStart={() => setHeld(true)}
      onTouchEnd={() => setHeld(false)}
      onClick={() => {
        if (flicked.current) {
          flicked.current = false;
          return;
        }
        onOpen();
      }}
    >
      <div className="relative size-11 flex-none">
        {!still ? (
          <>
            <motion.span
              aria-hidden="true"
              className="absolute inset-0 rounded-full border-2 border-primary"
              initial={{ scale: 1, opacity: 0.9 }}
              animate={{ scale: 2, opacity: 0 }}
              transition={{ delay: 0.12, duration: 0.7, ease: [0.2, 0.7, 0.3, 1] }}
            />
            {pieces.map((piece, index) => (
              <motion.span
                key={index}
                aria-hidden="true"
                className={`absolute top-1/2 left-1/2 ${piece.tone} ${piece.round ? "rounded-full" : "rounded-[1px]"}`}
                style={{ width: piece.size, height: piece.size, marginLeft: -piece.size / 2, marginTop: -piece.size / 2 }}
                initial={{ x: 0, y: 0, opacity: 1, scale: 0.4, rotate: 0 }}
                animate={{ x: piece.x, y: piece.y, opacity: 0, scale: 1, rotate: piece.rotate }}
                transition={{ delay: piece.delay, duration: 0.75, ease: "easeOut" }}
              />
            ))}
          </>
        ) : null}
        <motion.span
          className="relative flex size-full items-center justify-center rounded-full border-[1.5px] border-ink bg-primary text-ink"
          initial={still ? { opacity: 0 } : { scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ delay: still ? 0 : 0.06, ...pop }}
        >
          <Icon name="check" size={24} strokeWidth={3} />
        </motion.span>
      </div>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[15px] font-semibold">{title}</span>
        <span className="truncate text-[13px] opacity-75">{line}</span>
      </span>
      <span className="flex-none text-[13px] font-semibold underline underline-offset-3">View</span>
    </motion.div>
  );
}

/**
 * Mounted once in the signed-in shell: shows the toast for applications sent since this device last showed one, on
 * any page, and for the ones sent while the user was away (one toast for all of them). Each is shown once per device.
 */
export function SentCelebration() {
  const { sent, celebrated } = useApplicationsSummary();
  const router = useRouter();
  const news = sent && sent.sent.length > 0 ? sent : null;
  const last = news ? Math.max(...news.sent.map((item) => item.submittedAt)) : 0;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(max(12px,env(safe-area-inset-top))+52px)] z-50 mx-auto box-border w-full max-w-[480px] px-4">
      <AnimatePresence>
        {news ? (
          <SentToast
            key={last}
            news={news}
            onDone={() => celebrated(last)}
            onOpen={() => {
              celebrated(last);
              router.push(news.sent.length === 1 ? `/applications/${news.sent[0].id}` : "/applications");
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
