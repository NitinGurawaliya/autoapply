"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { CompanyMark } from "@/components/ui/marks";
import { cn } from "@/lib/utils";
import { chord, PENTATONIC, roll, setSoundOn, soundOn, startSound, subscribeSound, thump, tick, tone, whoosh } from "@/lib/reveal-sound";
import type { DailyStats } from "@/modules/jobs";
import s from "./daily-reveal.module.css";

/** One of today's picks, as the arc's card shows it. */
export type RevealPick = {
  id: string;
  company: string;
  logoUrl: string | null;
  title: string;
  board: string | null;
  place: string;
  /** "Fresher · ₹15L – ₹30L": the level and pay, when known. */
  level: string | null;
  reason: string;
  have: string[];
  /** The score's parts, points of max (the card's split bar). */
  parts: Array<{ points: number; max: number }>;
  score: number;
};

const COLS = 10;
const ROWS = 13;
/** One card's width on the arc: dragging this far turns the ring by one card. */
const SLOT = 132;
const fmt = (n: number) => n.toLocaleString("en-IN");
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

// A fixed shuffle and jitter, so the same day always draws the same field.
function seeded(seed: number) {
  let state = seed;
  return () => (state = (state * 9301 + 49297) % 233280) / 233280;
}
function shuffled(n: number, seed: number) {
  const rand = seeded(seed);
  const list = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
// Round the ring: the best in the middle, 1, 3, 5… to its right and …4, 2 to its left. `pos[card]` is its place.
function ring(n: number) {
  const seq = [0];
  for (let i = 1; i < n; i += 2) seq.push(i);
  for (let i = n % 2 === 0 ? n - 2 : n - 1; i >= 2; i -= 2) seq.push(i);
  const pos: number[] = [];
  seq.forEach((card, p) => (pos[card] = p));
  return { seq, pos };
}

/**
 * The daily reveal (Phase R, docs/reveal/TDD.md): what the agent did today, then its picks as an arc of cards. Full: the
 * camera comes down over the open jobs it read (a sample of the user's real pool), a scan drops the ones outside their
 * fields, the picks rise and fly onto the arc. Short (after the first days): the field already there, the picks rise.
 * A tap skips to the arc; reduced motion shows it at once. `onSeen` once the arc is shown; `onOpen(i)` with the card in
 * front when the user asks for today's jobs.
 */
export function DailyReveal({ picks, stats, full, onSeen, onOpen }: { picks: RevealPick[]; stats: DailyStats; full: boolean; onSeen: () => void; onOpen: (index: number) => void }) {
  const n = picks.length;
  const { seq, pos } = useMemo(() => ring(n), [n]);
  const tiles = useMemo(() => {
    const rand = seeded(3);
    const order = shuffled(COLS * ROWS, 11);
    const pickAt = new Map(order.slice(0, n).map((tile, k) => [tile, k]));
    return Array.from({ length: COLS * ROWS }, (_, i) => {
      const row = Math.floor(i / COLS);
      const col = i % COLS;
      const k = pickAt.get(i);
      const job = k != null ? { company: picks[k].company, logo: picks[k].logoUrl } : stats.field[i % Math.max(1, stats.field.length)] ?? { company: "", logo: null };
      return { i, row, left: col * 32 + 2 + (rand() - 0.5) * 3, top: row * 39 + (rand() - 0.5) * 3, fog: 0.3 + 0.7 * (row / (ROWS - 1)), job, pick: k ?? null };
    });
  }, [n, picks, stats.field]);
  const order = useMemo(() => shuffled(COLS * ROWS, 11), []);

  const root = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const arc = useRef<HTMLDivElement>(null);
  const countBox = useRef<HTMLDivElement>(null);
  const number = useRef<HTMLSpanElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const scan = useRef<HTMLElement>(null);
  const timers = useRef<number[]>([]);
  const turn = useRef(0);
  const [landed, setLanded] = useState(false);
  // The device's choice; on while the server renders.
  const sound = useSyncExternalStore(subscribeSound, soundOn, () => true);
  const seenOnce = useRef(false);

  const tileEls = () => [...(plane.current?.querySelectorAll<HTMLElement>(`.${s.tile}`) ?? [])];
  const cardEls = () => [...(arc.current?.children ?? [])] as HTMLElement[];
  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));

  // Each card's place on the arc for a (fractional, while dragged) turn of the ring.
  function layArc(animate = true) {
    cardEls().forEach((card, i) => {
      let d = (pos[i] - turn.current) % n;
      if (d > n / 2) d -= n;
      if (d <= -n / 2) d += n;
      const a = Math.abs(d);
      card.style.transition = animate ? "" : "none";
      card.style.transform = `translate3d(${d * SLOT}px, ${a * 6}px, ${-a * 104}px) rotateY(${-d * 34}deg)`;
      card.style.opacity = a <= 2.2 ? "1" : String(Math.max(0, 1 - (a - 2.2) / 0.5));
      card.style.zIndex = String(Math.round(100 - a * 10));
      card.style.setProperty("--veil", String(Math.min(0.62, a * 0.3)));
      card.style.pointerEvents = a > 2.4 ? "none" : "";
    });
  }

  function finish() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    plane.current?.classList.add(s.away);
    countBox.current?.classList.add(s.gone);
    turn.current = 0;
    layArc();
    setLanded(true);
    if (!seenOnce.current) {
      seenOnce.current = true;
      onSeen();
    }
  }

  // The number rolls like an odometer: each digit spins to its new value, the right-hand ones further.
  function say(to: number, text: string) {
    const el = number.current;
    const lab = label.current;
    if (!el || !lab) return;
    lab.style.opacity = "0";
    later(160, () => {
      lab.textContent = text;
      lab.style.opacity = "1";
    });
    const before = (el.dataset.v ?? "").replace(/\D/g, "");
    const str = fmt(to);
    const digits = str.replace(/\D/g, "");
    el.innerHTML = [...str]
      .map((ch) => (/\d/.test(ch) ? `<span class="${s.digit}"><span class="${s.column}">${"012345678901234567890123456789".split("").map((d) => `<span>${d}</span>`).join("")}</span></span>` : `<span class="${s.sep}">${ch}</span>`))
      .join("");
    const cols = [...el.querySelectorAll<HTMLElement>(`.${s.column}`)];
    cols.forEach((col, i) => {
      const was = Number(before[before.length - (cols.length - i)] ?? 0);
      col.style.transition = "none";
      col.style.transform = `translateY(${-was}em)`;
    });
    el.getBoundingClientRect();
    cols.forEach((col, i) => {
      const fromRight = cols.length - 1 - i;
      col.style.transition = "";
      col.style.transitionDelay = `${i * 40}ms`;
      col.style.transform = `translateY(${-(Number(digits[i]) + 10 * (fromRight === 0 ? 2 : fromRight < 3 ? 1 : 0))}em)`;
    });
    el.dataset.v = str;
    roll(950);
  }

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Reduced motion: the arc at once (on the next tick, outside the effect's own run).
    if (reduced) {
      later(0, finish);
      return;
    }
    const all = tileEls();
    const cards = cardEls();
    const picksAt = order.slice(0, n);
    const near = order.slice(n, n + 16);
    const rest = order.slice(n + 16);
    const startAt = full ? 0 : 400;
    requestAnimationFrame(() => requestAnimationFrame(() => plane.current?.classList.add(s.on)));
    if (full) {
      whoosh(2.6, 180, 900, 0.12);
      say(stats.read, "open jobs read today");
      // The scan sweeps the field front to back; what is outside the user's fields falls away behind it.
      later(1300, () => {
        say(stats.fields, "in your fields");
        if (scan.current) {
          scan.current.style.top = "0%";
          scan.current.classList.add(s.on);
        }
        whoosh(0.9, 900, 3200, 0.08);
        later(900, () => scan.current?.classList.remove(s.on));
        for (const t of rest) later((ROWS - 1 - Math.floor(t / COLS)) * 60 + (t % 7) * 9, () => all[t]?.classList.add(s.out));
        for (let r = 0; r < ROWS; r += 3) thump(((ROWS - 1 - r) * 60) / 1000 + 0.15, 0.05);
        near.forEach((t) => all[t]?.classList.add(s.fit));
      });
    } else {
      // Short: the field is there already, without the ones outside the user's fields.
      rest.forEach((t) => all[t]?.classList.add(s.out));
      near.forEach((t) => all[t]?.classList.add(s.out));
    }
    const rise = full ? 2300 : startAt;
    // The picks rise off the field, each casting a shadow, each with a note.
    later(rise, () => {
      say(n, "picked for you");
      near.forEach((t) => all[t]?.classList.add(s.out));
      picksAt.forEach((t, k) =>
        later(k * 55, () => {
          const tile = all[t];
          if (!tile || !plane.current) return;
          const shade = document.createElement("i");
          shade.className = s.shade;
          shade.style.left = tile.style.left;
          shade.style.top = tile.style.top;
          plane.current.insertBefore(shade, plane.current.firstChild);
          requestAnimationFrame(() => shade.classList.add(s.on));
          tile.classList.add(s.pick);
          tone(PENTATONIC[k % PENTATONIC.length], 0.7, 0.05);
        }),
      );
    });
    // Each pick flies from its tile onto the arc; the best lands last, in the middle.
    const fly = rise + 1100;
    later(fly, () => {
      const frame = arc.current?.getBoundingClientRect();
      if (!frame) return;
      cards.forEach((card, i) => {
        const tile = all[picksAt[i]]?.getBoundingClientRect();
        if (!tile) return;
        card.style.transition = "none";
        card.style.transform = `translate3d(${tile.left + tile.width / 2 - (frame.left + frame.width / 2)}px, ${tile.top + tile.height / 2 - (frame.top + frame.height / 2)}px, 0) scale(0.1)`;
        card.style.opacity = "0";
        card.getBoundingClientRect();
      });
      whoosh(1.1, 400, 2400, 0.12);
      turn.current = 0;
      cards.forEach((card, i) =>
        later(80 + (n - 1 - i) * 70, () => {
          card.style.transition = "transform 760ms cubic-bezier(.2,.8,.2,1), opacity 420ms cubic-bezier(.2,.8,.2,1)";
          layArcCard(card, i);
          if (Math.abs(slotOf(i)) <= 2) thump(0.5, 0.06);
        }),
      );
      later(400, () => {
        plane.current?.classList.add(s.away);
        countBox.current?.classList.add(s.gone);
      });
      chord(1.35);
    });
    later(fly + n * 70 + 700, finish);
    const own = timers.current;
    return () => own.forEach(clearTimeout);
    // The timeline runs once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function slotOf(i: number) {
    let d = pos[i] % n;
    if (d > n / 2) d -= n;
    return d;
  }
  function layArcCard(card: HTMLElement, i: number) {
    const d = slotOf(i);
    const a = Math.abs(d);
    card.style.transform = `translate3d(${d * SLOT}px, ${a * 6}px, ${-a * 104}px) rotateY(${-d * 34}deg)`;
    card.style.opacity = a <= 2.2 ? "1" : "0";
    card.style.zIndex = String(Math.round(100 - a * 10));
    card.style.setProperty("--veil", String(Math.min(0.62, a * 0.3)));
  }

  // Dragging the arc turns the ring, a flick carries it on, it settles on a card; a tap brings a card round.
  const drag = useRef<{ x0: number; base: number; moved: boolean; trail: Array<[number, number]>; crossed: number } | null>(null);
  function onPointerDown(e: React.PointerEvent) {
    startSound();
    if (!landed) return;
    drag.current = { x0: e.clientX, base: turn.current, moved: false, trail: [[e.clientX, performance.now()]], crossed: Math.round(turn.current) };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    arc.current?.classList.remove(s.idle);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (Math.abs(dx) > 5) d.moved = true;
    if (!d.moved) return;
    d.trail.push([e.clientX, performance.now()]);
    if (d.trail.length > 6) d.trail.shift();
    turn.current = d.base - dx / SLOT;
    layArc(false);
    if (Math.round(turn.current) !== d.crossed) {
      d.crossed = Math.round(turn.current);
      tick();
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!landed) {
      finish();
      return;
    }
    if (!d) return;
    if (!d.moved) {
      const card = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest(`.${s.mini}`);
      const i = card ? cardEls().indexOf(card as HTMLElement) : -1;
      if (i >= 0) {
        const now = Math.round(turn.current);
        let delta = (pos[i] - now) % n;
        if (delta > n / 2) delta -= n;
        if (delta <= -n / 2) delta += n;
        turn.current = now + delta;
        layArc();
        whoosh(0.35, 600, 1800, 0.07);
      }
    } else {
      const [[xa, ta], [xb, tb]] = [d.trail[0], d.trail[d.trail.length - 1]];
      const v = tb > ta ? (xb - xa) / (tb - ta) : 0;
      turn.current = Math.round(turn.current - v * 1.6);
      layArc();
      whoosh(0.3, 700, 1600, 0.05);
    }
    window.setTimeout(() => arc.current?.classList.add(s.idle), 700);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (!landed) {
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") finish();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      turn.current = Math.round(turn.current) + (e.key === "ArrowRight" ? 1 : -1);
      layArc();
      tick();
    }
  }

  const front = () => seq[((Math.round(turn.current) % n) + n) % n];

  return (
    <div ref={root} className={s.root} role="region" aria-label="What your agent found today" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className={cn(s.scene, landed && s.grab)} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => (drag.current = null)}>
        <button
          type="button"
          className={s.sound}
          aria-pressed={sound}
          aria-label={sound ? "Turn sound off" : "Turn sound on"}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={() => {
            setSoundOn(!sound);
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
            {sound ? <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" /> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
          </svg>
        </button>
        <div ref={countBox} className={s.count} aria-live="polite">
          <span ref={number} className={cn(s.number, "type-score")} />
          <span ref={label} className={cn(s.label, "type-body")} />
        </div>
        <div ref={plane} className={s.plane} aria-hidden>
          {tiles.map((tile) => (
            <i key={tile.i} className={cn(s.tile, tile.row < 3 && s.far)} style={{ left: tile.left, top: tile.top, ["--fog" as string]: tile.fog.toFixed(2) }}>
              {tile.job.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tile.job.logo} alt="" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")} />
              ) : (
                <span className={s.initial}>{tile.job.company.trim()[0]?.toUpperCase() ?? ""}</span>
              )}
            </i>
          ))}
          <i ref={scan} className={s.scan} />
        </div>
        <div ref={arc} className={s.arc}>
          {picks.map((pick) => (
            <article key={pick.id} className={s.mini} aria-label={`${pick.title} at ${pick.company}, ${pick.score} match`}>
              <div className={s.miniTop}>
                <CompanyMark name={pick.company} logoUrl={pick.logoUrl} size={36} />
                <div className={s.miniWho}>
                  <b className="type-meta font-semibold">{pick.company}</b>
                  {pick.board ? <span className="type-meta text-muted-foreground">via {pick.board}</span> : null}
                </div>
                <div className={s.miniScore}>
                  <span className="type-score tabular-nums">{pick.score}</span>
                  <span className="block type-meta text-muted-foreground">match</span>
                </div>
              </div>
              <h3 className={cn(s.miniTitle, "type-section")}>{pick.title}</h3>
              <p className={cn(s.ellipsis, "m-0 mt-2 type-meta")}>
                <span className="font-medium">{pick.place}</span>
                {pick.level ? <span className="text-muted-foreground"> · {pick.level}</span> : null}
              </p>
              <p className={cn(s.miniReason, "type-meta")}>{sentence(pick.reason)}</p>
              <div className={s.miniSplit}>
                {pick.parts.map((part, k) => (
                  <i key={k} style={{ flex: part.max, ["--f" as string]: `${Math.round((100 * part.points) / Math.max(1, part.max))}%` }} />
                ))}
              </div>
              {pick.have.length > 0 ? (
                <p className={cn(s.ellipsis, "m-0 mt-2.5 type-meta")}>
                  <span className="mr-1.5 text-muted-foreground">You have</span>
                  {pick.have.slice(0, 2).join(", ")}
                  {pick.have.length > 2 ? ` +${pick.have.length - 2}` : ""}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </div>
      <div className={cn(s.words, landed && s.in)}>
        <h1 className="m-0 type-heading">Today&apos;s jobs</h1>
        <p className="m-0 mt-2 mb-6 type-body text-muted-foreground">
          Your agent read {fmt(stats.read)} open jobs in India and found these {n} for you.
        </p>
        <Button
          variant="primary"
          size="xl"
          className="w-full"
          onClick={() => {
            whoosh(0.5, 300, 1500, 0.1);
            onOpen(front());
          }}
        >
          See today&apos;s {n}
        </Button>
        <p className="m-0 mt-3 text-center type-meta text-muted-foreground">Drag the cards, or tap one to bring it round</p>
      </div>
    </div>
  );
}
