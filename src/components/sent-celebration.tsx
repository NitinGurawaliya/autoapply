"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { buttonVariants } from "@/components/ui/button";
import { AccentPill } from "@/components/ui/chip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Icon } from "@/components/ui/icons";
import { CompanyMark } from "@/components/ui/marks";
import { useApplicationsSummary, type SentNews } from "@/components/applications-summary";

// A burst of small pieces in the app's own colours (lime, ink, the edge grey): squares, dots and short bars.
type Piece = { x: number; y: number; fall: number; rotate: number; size: number; shape: "square" | "dot" | "bar"; tone: string; delay: number; duration: number };
const TONES = ["bg-primary", "bg-primary", "bg-foreground", "bg-edge"];

function burst(count: number): Piece[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const distance = 90 + Math.random() * 90;
    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance * 0.8 - 30,
      fall: 50 + Math.random() * 70,
      rotate: (Math.random() - 0.5) * 540,
      size: 6 + Math.round(Math.random() * 5),
      shape: (["square", "dot", "bar"] as const)[index % 3],
      tone: TONES[index % TONES.length],
      delay: 0.1 + Math.random() * 0.12,
      duration: 1.1 + Math.random() * 0.5,
    };
  });
}

/** The line that makes the number feel like progress: a first, a round number, or this week's count. */
function milestone(total: number | null, week: number | null): string | null {
  if (total === 1) return "Your first application is out";
  if (total && [5, 10, 25, 50, 75, 100, 150, 200, 300, 500].includes(total)) return `${total} applications sent`;
  if (week && week > 1) return `${week} sent this week`;
  return null;
}

/**
 * The "Sent!" moment (owner, 1 Nov: an application going out is the big moment in the app). A lime disc pops in with an
 * ink check, two rings and a burst of pieces fly out, the phone gives a short buzz, and the card says where it went and
 * what that adds up to. Under reduced motion it simply fades in. Built from the app's parts: the swipe card's frame,
 * lime as a fill, ink for the check, no gradients.
 */
export function SentMoment({ news, onDone, onSee }: { news: SentNews; onDone: () => void; onSee: () => void }) {
  const still = useReducedMotion();
  const [pieces] = useState(() => burst(28));
  const done = useRef<HTMLButtonElement>(null);
  const many = news.sent.length > 1;
  const first = news.sent[0];
  const line = milestone(news.sentTotal, news.sentThisWeek);

  useEffect(() => {
    done.current?.focus();
    if (!still) {
      try {
        navigator.vibrate?.([24, 60, 90]);
      } catch {
        // No vibration on this device.
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [still, onDone]);

  const pop = still ? { duration: 0.2 } : { type: "spring" as const, stiffness: 420, damping: 13, mass: 0.9 };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center px-4 pb-[calc(20px+env(safe-area-inset-bottom))] sm:items-center">
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 bg-ink/55"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        onClick={onDone}
      />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sent-moment-title"
        aria-describedby="sent-moment-text"
        data-sent-moment=""
        className="relative box-border w-full max-w-[400px] rounded-card border-2 border-edge bg-surface px-6 pt-9 pb-6 text-center text-foreground shadow-hard-lg"
        initial={still ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={still ? { duration: 0.2 } : { type: "spring", stiffness: 320, damping: 26 }}
      >
        <div className="relative mx-auto size-[104px]">
          {!still ? (
            <>
              {[0.15, 0.38].map((delay) => (
                <motion.span
                  key={delay}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full border-[3px] border-primary"
                  initial={{ scale: 1, opacity: 0.9 }}
                  animate={{ scale: 2.2, opacity: 0 }}
                  transition={{ delay, duration: 0.9, ease: [0.2, 0.7, 0.3, 1] }}
                />
              ))}
              {pieces.map((piece, index) => (
                <motion.span
                  key={index}
                  aria-hidden="true"
                  className={`absolute top-1/2 left-1/2 ${piece.tone} ${piece.shape === "dot" ? "rounded-full" : "rounded-[2px]"}`}
                  style={{ width: piece.shape === "bar" ? piece.size * 0.5 : piece.size, height: piece.shape === "bar" ? piece.size * 1.8 : piece.size, marginLeft: -piece.size / 2, marginTop: -piece.size / 2 }}
                  initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.4 }}
                  animate={{ x: piece.x, y: [0, piece.y, piece.y + piece.fall], opacity: [1, 1, 0], rotate: piece.rotate, scale: 1 }}
                  transition={{ delay: piece.delay, duration: piece.duration, ease: "easeOut", times: [0, 0.45, 1] }}
                />
              ))}
            </>
          ) : null}
          <motion.div
            className="relative flex size-full items-center justify-center rounded-full border-2 border-ink bg-primary text-ink"
            initial={still ? { opacity: 0 } : { scale: 0, rotate: -25 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={pop}
          >
            <motion.span initial={still ? false : { scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: still ? 0 : 0.16, ...pop }}>
              <Icon name="check" size={54} strokeWidth={3} />
            </motion.span>
          </motion.div>
        </div>

        <Eyebrow as="p" className="mt-6">
          {many ? "Applications sent" : "Application sent"}
        </Eyebrow>
        <motion.h2
          id="sent-moment-title"
          className="m-0 mt-1 type-display-2xl"
          initial={still ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: still ? 0 : 0.22, ...pop }}
        >
          {many ? `${news.sent.length} sent!` : "Sent!"}
        </motion.h2>

        {many ? (
          <div className="mt-5 flex flex-col items-center gap-3">
            <div className="flex -space-x-3">
              {news.sent.slice(0, 4).map((item) => (
                <span key={item.id} className="rounded-tile ring-2 ring-surface">
                  <CompanyMark name={item.company} logoUrl={item.logoUrl} size={44} />
                </span>
              ))}
            </div>
            <p id="sent-moment-text" className="m-0 type-lead text-pretty">
              Your agent sent applications to {listCompanies(news.sent.map((item) => item.company))}.
            </p>
          </div>
        ) : (
          <div className="mt-5 flex items-center gap-3 rounded-panel border-[1.5px] border-line p-3 text-left">
            <CompanyMark name={first.company} logoUrl={first.logoUrl} size={44} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[15px] font-semibold">{first.title}</span>
              <span id="sent-moment-text" className="truncate type-caption text-muted-foreground">
                Your application is in at {first.company}
              </span>
            </div>
          </div>
        )}

        {line ? (
          <motion.div
            className="mt-4 flex justify-center"
            initial={still ? false : { y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: still ? 0 : 0.45, duration: 0.3 }}
          >
            <AccentPill className="h-8 px-3.5 text-sm">{line}</AccentPill>
          </motion.div>
        ) : null}

        <div className="mt-6 flex flex-col gap-2">
          <button ref={done} type="button" onClick={onDone} className={buttonVariants({ variant: "primary", size: "xl", className: "w-full" })}>
            Keep going
          </button>
          <button type="button" onClick={onSee} className={buttonVariants({ variant: "plain", size: "lg", className: "w-full" })}>
            {many ? "See my applications" : "See the application"}
          </button>
        </div>
      </motion.section>
    </div>
  );
}

function listCompanies(names: string[]) {
  const unique = [...new Set(names)];
  if (unique.length <= 2) return unique.join(" and ");
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

/**
 * Mounted once in the signed-in shell: shows the "Sent!" moment for applications sent since this device last showed
 * one, wherever the user is (the feed, an application, an answers page), and for the ones sent while they were away.
 * It waits while another dialog (the needs-you sheet) is open, so two never stack.
 */
export function SentCelebration() {
  const { sent, celebrated } = useApplicationsSummary();
  const router = useRouter();
  const pathname = usePathname();
  const [blocked, setBlocked] = useState(false);

  // Another dialog on screen (the needs-you sheet cannot be dismissed): wait for it, checking as the shell polls.
  useEffect(() => {
    if (!sent) return;
    const check = () => setBlocked(Boolean(document.querySelector('[role="dialog"]:not([data-sent-moment])')));
    check();
    const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [sent]);

  if (!sent || sent.sent.length === 0 || blocked) return null;
  const last = Math.max(...sent.sent.map((item) => item.submittedAt));
  const see = () => {
    celebrated(last);
    const target = sent.sent.length === 1 ? `/applications/${sent.sent[0].id}` : "/applications";
    if (pathname !== target) router.push(target);
  };
  return <SentMoment key={last} news={sent} onDone={() => celebrated(last)} onSee={see} />;
}
