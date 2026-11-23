"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, FieldLabel, InputBox } from "@/components/ui/field";
import { OtpInput } from "@/components/ui/otp-input";
import { Icon } from "@/components/ui/icons";
import { AgentStatus } from "@/components/patterns/agent-status";
import { InfoNote } from "@/components/patterns/content";
import type { StreamTicket } from "@/modules/sources";

// The streamed sign-in (K8, docs/naukri/TDD.md 13.12 "Mobile UX"): the site's own login page, running in a browser on
// our worker, shown here; the person's taps and keys go back to it. Frames come straight from the worker (server-sent
// events over fetch, so the token rides in a header, not the address) and are only ever drawn, never kept. Keys go
// through a hidden password box: phone keyboards do not learn or suggest from one, and it is emptied after every key.
//
// OTP connect (K8b, owner 23 Nov, docs/naukri/TDD.md 13.16) is the main path: the user types their mobile number and
// then the code the site texts them, here; the worker enters both on the site's own page. The page itself is shown only
// when the site asks for a check. Neither the number nor the code is kept in this page after it is sent.

type Phase =
  | { name: "loading" }
  | { name: "slow" }
  | { name: "saving" }
  | { name: "live" }
  | { name: "number"; saved: string | null }
  | { name: "code" }
  | { name: "error"; message: string }
  | { name: "expired" }
  | { name: "connected"; accountLabel: string | null }
  | { name: "failed"; message: string };

type Frame = { d: string; w: number; h: number };
type OtpReply = { state: "code_sent" | "accepted" | "check" | "busy" } | { state: "refused"; message: string } | { state: "wait"; seconds: number };
type InputEvent = { t: "tap"; x: number; y: number } | { t: "scroll"; x: number; y: number; dy: number } | { t: "text"; s: string } | { t: "key"; k: string };

const TICKET_POLL_MS = 1500;
// The worker opens Chrome and Naukri's page in a few seconds; past this the sheet says it is taking longer.
const SLOW_AFTER_MS = 30_000;
const FLUSH_MS = 40;
const TAP_SLOP_PX = 10;
const SENTINEL = "  ";
const SPECIAL_KEYS = new Set(["Enter", "Backspace", "Tab", "ArrowLeft", "ArrowRight"]);
// Naukri lets a new code be asked for after about 30 s.
const RESEND_AFTER_S = 30;
const CODE_LENGTH = 6;

/** The page size to ask the worker for: the picture is drawn 1:1 in the sheet, so text on it reads at its own size. */
function phoneViewport() {
  const width = Math.round(Math.min(window.innerWidth, 480) - 40);
  const height = Math.round(window.innerHeight * 0.92 - 190);
  return { width: Math.min(600, Math.max(280, width)), height: Math.min(1100, Math.max(400, height)) };
}

/** Reads server-sent events from a fetch body; calls `onEvent` for each complete event. */
async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (name: string, data: string) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf("\n\n");
    while (cut >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let name = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) name = line.slice(7);
        else if (line.startsWith("data: ")) data.push(line.slice(6));
      }
      if (data.length) onEvent(name, data.join("\n"));
      cut = buffer.indexOf("\n\n");
    }
  }
}

/** `onClose` shuts the sheet; `onCancel` withdraws the sign-in (the worker closes the window); `onSettled` refreshes the card. */
export function SignInStream({ site, label, onSettled, onClose, onCancel }: { site: string; label: string; onSettled: () => void; onClose: () => void; onCancel: () => void }) {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [frame, setFrame] = useState<Frame | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ticketRef = useRef<{ url: string; token: string } | null>(null);
  const queue = useRef<InputEvent[]>([]);
  const sending = useRef(false);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboard = useRef<HTMLInputElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const frameRef = useRef<Frame | null>(null);
  const gesture = useRef<{ x: number; y: number; lastY: number; scrolled: boolean } | null>(null);
  // OTP connect: "otp" shows our own number and code screens, "page" the site's page (a check).
  const mode = useRef<"otp" | "page">("page");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [savedNumber, setSavedNumber] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  // The site's page is on screen for a check (OTP connect): say why, and offer the way back.
  const [checking, setChecking] = useState(false);
  // The card refreshes itself every few seconds and hands a new callback each time; the stream must not restart for it.
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);
  const [resendIn, setResendIn] = useState(0);

  /**
   * What the server says once the stream ends: connected, or why not. `active` is false once the run that asked was
   * replaced (React runs an effect twice in development): a stale answer then changes nothing.
   */
  const settle = useCallback(async (active: () => boolean = () => true) => {
    const response = await fetch(`/api/sources/${site}/stream`, { cache: "no-store" }).catch(() => null);
    const ticket = response?.ok ? ((await response.json()) as StreamTicket) : null;
    if (!active()) return true;
    if (ticket?.state === "ended") {
      if (ticket.status === "connected") setPhase({ name: "connected", accountLabel: ticket.accountLabel });
      else if (ticket.lastError?.includes("10 minutes")) setPhase({ name: "expired" });
      else setPhase({ name: "failed", message: ticket.lastError ?? "The sign-in did not finish." });
      onSettledRef.current();
      return true;
    }
    return false;
  }, [site]);

  // Ask for the pass, then open the stream; again on "Try again".
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    const started = Date.now();
    const active = () => !stopped;
    async function run() {
      setPhase({ name: "loading" });
      // 1. The pass: the worker's address and a token for this window only.
      let ticket: StreamTicket | null = null;
      while (!stopped) {
        const response = await fetch(`/api/sources/${site}/stream`, { cache: "no-store", signal: controller.signal }).catch(() => null);
        ticket = response?.ok ? ((await response.json()) as StreamTicket) : null;
        // A run replaced meanwhile (its request aborted) must not paint over the one that replaced it.
        if (stopped) return;
        if (!ticket) {
          setPhase({ name: "error", message: "Could not reach SwipeApply. Check your connection." });
          return;
        }
        if (ticket.state === "ready") break;
        if (ticket.state === "ended") {
          await settle(active);
          return;
        }
        if (Date.now() - started > SLOW_AFTER_MS) setPhase({ name: "slow" });
        await new Promise((resolve) => setTimeout(resolve, TICKET_POLL_MS));
      }
      if (stopped || ticket?.state !== "ready") return;
      ticketRef.current = { url: ticket.url, token: ticket.token };
      // 2. The frames, straight from the worker.
      const size = phoneViewport();
      // Frames off until the page itself is needed: the number and code screens are ours.
      const response = await fetch(`${ticket.url}?w=${size.width}&h=${size.height}&frames=0`, {
        headers: { Authorization: `Bearer ${ticket.token}` },
        cache: "no-store",
        signal: controller.signal,
      }).catch(() => null);
      if (stopped) return;
      if (!response?.ok || !response.body) {
        // A stream that is gone (signed in a moment ago, or expired) reads as not found: ask how it ended.
        if (!(await settle(active))) setPhase({ name: "error", message: `Could not open ${label}'s sign-in.` });
        return;
      }
      let ended = false;
      let replaced = false;
      await readEvents(response.body, (name, data) => {
        if (name === "open") {
          const opened = JSON.parse(data) as { otp?: boolean; savedNumber?: string | null };
          if (opened.otp) {
            mode.current = "otp";
            setSavedNumber(opened.savedNumber ?? null);
            setPhase({ name: "number", saved: opened.savedNumber ?? null });
          } else {
            mode.current = "page";
            void post("input", { events: [], frames: true });
            setPhase({ name: "live" });
          }
        } else if (name === "frame") {
          const next = JSON.parse(data) as Frame;
          frameRef.current = next;
          setFrame(next);
          if (mode.current === "page") setPhase((current) => (current.name === "live" ? current : { name: "live" }));
        } else if (name === "end") ended = true;
        else if (name === "replaced") replaced = true;
      }).catch(() => undefined);
      if (stopped) return;
      frameRef.current = null;
      setFrame(null);
      if (replaced) {
        setPhase({ name: "error", message: "The sign-in opened in another tab. Continue here instead?" });
        return;
      }
      if (ended) {
        // The worker saves the sign-in after the stream ends: a few seconds before the connection says so.
        setPhase({ name: "saving" });
        for (let tries = 0; tries < 12 && !stopped; tries += 1) {
          if (await settle(active)) return;
          await new Promise((resolve) => setTimeout(resolve, TICKET_POLL_MS));
        }
      }
      if (stopped) return;
      if (!(await settle(active))) setPhase((current) => (current.name === "error" ? current : { name: "error", message: "The connection to the sign-in dropped." }));
    }
    void run();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [site, label, attempt, settle]);

  /** A POST to the worker's stream with this sign-in's pass; the reply's JSON, or null when it did not answer. */
  async function post(path: "input" | "login" | "code", body: unknown) {
    const ticket = ticketRef.current;
    if (!ticket) return null;
    const response = await fetch(`${ticket.url}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ticket.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    }).catch(() => null);
    if (!response) return null;
    return response.status === 204 ? {} : ((await response.json().catch(() => null)) as OtpReply | null);
  }

  /** The site wants a check: its page is shown for it, then the user comes back to the code. */
  function showPage() {
    mode.current = "page";
    setChecking(true);
    void post("input", { events: [], frames: true });
    setPhase({ name: "live" });
  }

  function backToCode() {
    mode.current = "otp";
    setChecking(false);
    void post("input", { events: [], frames: false });
    setOtpError("");
    setPhase(codeSent ? { name: "code" } : { name: "number", saved: savedNumber });
  }

  // The resend countdown.
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function sendCode(useSaved: boolean) {
    if (otpBusy) return;
    setOtpBusy(true);
    setOtpError("");
    const reply = (await post("login", useSaved ? { saved: true } : { mobile })) as OtpReply | null;
    setOtpBusy(false);
    if (!reply) return setOtpError(`Could not reach ${label}'s sign-in. Try again.`);
    if (reply.state === "code_sent") {
      setCodeSent(true);
      setCode("");
      setResendIn(RESEND_AFTER_S);
      setPhase({ name: "code" });
    } else if (reply.state === "check") showPage();
    else if (reply.state === "wait") setOtpError(`Wait ${reply.seconds} seconds, then ask again.`);
    else if (reply.state === "refused") setOtpError(reply.message);
  }

  async function submitCode(value: string) {
    if (otpBusy || value.length !== CODE_LENGTH) return;
    setOtpBusy(true);
    setOtpError("");
    const reply = (await post("code", { code: value })) as OtpReply | null;
    setOtpBusy(false);
    if (!reply) return setOtpError(`Could not reach ${label}'s sign-in. Try again.`);
    if (reply.state === "accepted") setPhase({ name: "saving" });
    else if (reply.state === "check") showPage();
    else if (reply.state === "refused") {
      setOtpError(reply.message);
      setCode("");
    }
  }

  async function flush() {
    flushTimer.current = null;
    const ticket = ticketRef.current;
    if (sending.current || !ticket || queue.current.length === 0) return;
    sending.current = true;
    const events = queue.current.splice(0, 64);
    try {
      await fetch(`${ticket.url}/input`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ticket.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
        cache: "no-store",
      }).catch(() => undefined);
    } finally {
      sending.current = false;
      if (queue.current.length) void flush();
    }
  }

  function send(event: InputEvent) {
    // Consecutive characters travel together.
    const last = queue.current.at(-1);
    if (event.t === "text" && last?.t === "text" && last.s.length + event.s.length <= 256) last.s += event.s;
    else queue.current.push(event);
    if (!flushTimer.current) flushTimer.current = setTimeout(() => void flush(), FLUSH_MS);
  }

  /** A point on the picture, in the page's own pixels. */
  function pagePoint(clientX: number, clientY: number) {
    const image = picture.current;
    const current = frameRef.current;
    if (!image || !current) return null;
    const box = image.getBoundingClientRect();
    return { x: ((clientX - box.left) / box.width) * current.w, y: ((clientY - box.top) / box.height) * current.h };
  }

  function onPointerDown(event: React.PointerEvent) {
    gesture.current = { x: event.clientX, y: event.clientY, lastY: event.clientY, scrolled: false };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    const start = gesture.current;
    if (!start) return;
    if (!start.scrolled && Math.hypot(event.clientX - start.x, event.clientY - start.y) < TAP_SLOP_PX) return;
    start.scrolled = true;
    const point = pagePoint(event.clientX, event.clientY);
    const dy = start.lastY - event.clientY;
    start.lastY = event.clientY;
    if (point && dy) send({ t: "scroll", x: point.x, y: point.y, dy: Math.round(dy) });
  }

  function onPointerUp(event: React.PointerEvent) {
    const start = gesture.current;
    gesture.current = null;
    if (!start || start.scrolled) return;
    const point = pagePoint(event.clientX, event.clientY);
    if (!point) return;
    send({ t: "tap", x: Math.round(point.x), y: Math.round(point.y) });
    // A tap usually lands on a field: the phone's keyboard comes up (only a tap may open it).
    keyboard.current?.focus({ preventScroll: true });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!SPECIAL_KEYS.has(event.key)) return;
    event.preventDefault();
    send({ t: "key", k: event.key });
  }

  function onInput(event: React.FormEvent<HTMLInputElement>) {
    const box = event.currentTarget;
    const value = box.value;
    if (value.length < SENTINEL.length) send({ t: "key", k: "Backspace" });
    else if (value.length > SENTINEL.length) send({ t: "text", s: value.startsWith(SENTINEL) ? value.slice(SENTINEL.length) : value.trim() });
    box.value = SENTINEL;
  }

  const size = typeof window === "undefined" ? { width: 350, height: 560 } : phoneViewport();
  const live = phase.name === "live" && frame;

  if (phase.name === "number") {
    const usable = /^\d{10}$/.test(mobile);
    return (
      <form
        className="flex flex-col gap-4 pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void sendCode(false);
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 type-heading">Connect {label}</h2>
          <Button type="button" variant="quiet" size="text" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <p className="m-0 type-body text-muted-foreground">{label} texts you a code. You type it here.</p>
        {phase.saved ? (
          <>
            <Button type="button" variant="primary" size="xl" className="w-full" disabled={otpBusy} onClick={() => void sendCode(true)}>
              {otpBusy ? "Asking for a code..." : `Text a code to ${phase.saved}`}
            </Button>
            {otpError ? <FieldError>{otpError}</FieldError> : null}
            <Button type="button" variant="quiet" size="text" className="self-start" onClick={() => setPhase({ name: "number", saved: null })}>
              Use another number
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="naukri-mobile">Mobile number on your {label} account</FieldLabel>
              <InputBox
                id="naukri-mobile"
                prefix="+91"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="10 digits"
                value={mobile}
                onChange={(event) => setMobile(event.target.value.replace(/\D/g, "").slice(-10))}
                aria-invalid={Boolean(otpError) || undefined}
              />
              {otpError ? <FieldError>{otpError}</FieldError> : null}
            </div>
            <Button type="submit" variant="primary" size="xl" className="w-full" disabled={!usable || otpBusy}>
              {otpBusy ? "Asking for a code..." : "Send code"}
            </Button>
          </>
        )}
        <InfoNote size="sm">We never ask for your {label} password.</InfoNote>
      </form>
    );
  }

  if (phase.name === "code") {
    return (
      <div className="flex flex-col gap-4 pt-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 type-heading">Enter the code</h2>
          <Button type="button" variant="quiet" size="text" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <p className="m-0 type-body text-muted-foreground">{label} just texted it to your phone.</p>
        <OtpInput
          id="naukri-code"
          label={`Code from ${label}`}
          length={CODE_LENGTH}
          value={code}
          disabled={otpBusy}
          onChange={(value) => {
            const digits = value.replace(/\D/g, "");
            setCode(digits);
            if (digits.length === CODE_LENGTH) void submitCode(digits);
          }}
        />
        {otpError ? <FieldError>{otpError}</FieldError> : null}
        {otpBusy ? <AgentStatus text="Checking the code" size={32} /> : null}
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="quiet" size="text" disabled={resendIn > 0 || otpBusy} onClick={() => void sendCode(!mobile)}>
            {resendIn > 0 ? `Resend in 0:${String(resendIn).padStart(2, "0")}` : "Resend code"}
          </Button>
          <Button
            type="button"
            variant="quiet"
            size="text"
            onClick={() => {
              setCodeSent(false);
              setOtpError("");
              setPhase({ name: "number", saved: null });
            }}
          >
            Change number
          </Button>
        </div>
      </div>
    );
  }

  if (phase.name === "connected") {
    return (
      <div className="flex flex-col gap-4 pt-4">
        <span aria-hidden="true" className="flex size-12 items-center justify-center self-start rounded-card bg-inverse text-inverse-foreground">
          <Icon name="check" size={24} />
        </span>
        <p role="status" className="m-0 type-heading">{phase.accountLabel ? `Connected as ${phase.accountLabel}` : `${label} connected`}</p>
        <p className="m-0 type-body text-muted-foreground">New {label} jobs reach your feed in a few minutes.</p>
        <Button type="button" variant="primary" size="xl" className="w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }

  if (phase.name === "expired" || phase.name === "failed") {
    return (
      <div className="flex flex-col gap-4 pt-4">
        <p role="status" className="m-0 type-heading">{phase.name === "expired" ? "The sign-in closed" : "Not connected"}</p>
        <p className="m-0 type-body text-muted-foreground">{phase.name === "expired" ? "It stays open for 10 minutes. Connect again when you have your OTP to hand." : phase.message}</p>
        <Button type="button" variant="line" size="lg" className="w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 type-section">Sign in to {label}</h2>
        <Button type="button" variant="quiet" size="text" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div
        className="relative mx-auto box-border w-full overflow-hidden rounded-card border border-line bg-sunk"
        style={{ maxWidth: size.width, aspectRatio: frame ? `${frame.w} / ${frame.h}` : `${size.width} / ${size.height}` }}
      >
        {live ? (
          // eslint-disable-next-line @next/next/no-img-element -- a live JPEG from the worker, redrawn many times a second
          <img
            ref={picture}
            src={`data:image/jpeg;base64,${frame.d}`}
            alt={`${label} sign-in page`}
            draggable={false}
            className="block size-full touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (gesture.current = null)}
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-3 p-4">
            {phase.name === "error" ? (
              <>
                <FieldError>{phase.message}</FieldError>
                <Button type="button" variant="line" size="md" onClick={() => setAttempt((count) => count + 1)}>
                  Try again
                </Button>
              </>
            ) : (
              <AgentStatus
                text={phase.name === "saving" ? "Saving your sign-in" : `Opening ${label}`}
                detail={phase.name === "slow" ? "Taking longer than usual" : undefined}
                size={32}
              />
            )}
          </div>
        )}
      </div>
      {/* The keyboard's target: off screen, a password box so the phone's keyboard does not learn what is typed. 16 px stops iOS zooming in. */}
      <input
        ref={keyboard}
        type="password"
        aria-label={`Type into ${label}'s page`}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        defaultValue={SENTINEL}
        onKeyDown={onKeyDown}
        onInput={onInput}
        className="pointer-events-none absolute top-0 left-0 size-px opacity-0"
        style={{ fontSize: 16 }}
      />
      {checking && phase.name === "live" ? (
        <div className="flex items-center justify-between gap-3">
          <p className="m-0 type-meta text-muted-foreground">{label} wants a quick check. Do it on the page, then carry on.</p>
          <Button type="button" variant="line" size="md" className="flex-none" onClick={backToCode}>
            Done
          </Button>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <InfoNote size="sm">You type into {label}&apos;s own page. We never keep it.</InfoNote>
        {live ? (
          <Button type="button" variant="line" size="md" className="flex-none" onClick={() => keyboard.current?.focus({ preventScroll: true })}>
            Keyboard
          </Button>
        ) : null}
      </div>
    </div>
  );
}
