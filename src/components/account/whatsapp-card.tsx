"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/eyebrow";
import { cn } from "cn";

/**
 * Phase Y, Y2 (docs/whatsapp/TDD.md 5, design/whatsapp.html "The Account card"): SwipeApply on WhatsApp. Unlinked, linking
 * (the code, polling until the user's own "Join" message arrives), linked (the number masked), paused, stopped, plus loading
 * and error. Not rendered at all while WHATSAPP_ENABLED is off (the Account page decides). Pause and Resume come with Y5.
 */

type Status = {
  linked: boolean;
  phoneMasked: string | null;
  morningAt: string | null;
  dropsPerDay: number | null;
  pausedUntil: string | null;
  optedOut: boolean;
  chatUrl: string | null;
};

type Code = { url: string; code: string; expiresAt: number };

const POLL_MS = 3000;

function ChatMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4 4v-4h-.5A2.5 2.5 0 0 1 4 13.5z" />
    </svg>
  );
}

function Head({ meta, off }: { meta: string; off?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={cn("grid size-10 shrink-0 place-items-center rounded-control", off ? "bg-sunk text-faint" : "bg-foreground text-background")}>
        <ChatMark />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="m-0 text-lg font-semibold">SwipeApply on WhatsApp</h2>
        <p className="m-0 text-sm text-muted-foreground" aria-live="polite">
          {meta}
        </p>
      </div>
    </div>
  );
}

function Rows({ morningAt, dropsPerDay }: { morningAt: string | null; dropsPerDay: number | null }) {
  return (
    <div className="flex flex-col divide-y divide-line-strong text-sm">
      <p className="m-0 py-3 first:pt-0">Mornings at <span className="tabular-nums">{morningAt ?? "08:30"}</span></p>
      <p className="m-0 py-3 last:pb-0">
        <span className="tabular-nums">{dropsPerDay ?? 2}</span> job {dropsPerDay === 1 ? "drop" : "drops"} a day
      </p>
    </div>
  );
}

export function WhatsAppCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState<Code | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const read = useCallback(async () => {
    try {
      const response = await fetch("/api/whatsapp/link", { cache: "no-store" });
      if (!response.ok) throw new Error("read");
      const next = (await response.json()) as Status;
      setStatus(next);
      if (next.linked) setCode(null);
      setError("");
      return next;
    } catch {
      setError("Couldn't read your WhatsApp link. Check your connection and try again.");
      return null;
    }
  }, []);

  useEffect(() => {
    // The first read of the card: state is set after the response, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void read();
  }, [read]);

  // Waiting for the user's own message: look every few seconds while the tab is showing, until it arrives or the code lapses.
  const waiting = code !== null && !status?.linked;
  useEffect(() => {
    if (!waiting || !code) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() > code.expiresAt) {
        setCode(null);
        return;
      }
      void read();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, code, read]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/whatsapp/link", { method: "POST" });
      if (!response.ok) throw new Error(response.status === 429 ? "Too many tries. Try again in a while." : "start");
      const body = (await response.json()) as { url: string; code: string; expiresAt: string };
      setCode({ url: body.url, code: body.code, expiresAt: Date.parse(body.expiresAt) });
      window.open(body.url, "_blank", "noopener");
    } catch (failure) {
      setError(failure instanceof Error && failure.message !== "start" ? failure.message : "Couldn't start the link. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function removeLink() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/whatsapp/link", { method: "DELETE" });
      if (!response.ok) throw new Error("unlink");
      setCode(null);
      await read();
    } catch {
      setError("Couldn't unlink. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const shell = "box-border flex flex-col gap-4 rounded-panel border border-line bg-surface p-4";
  const open = (href: string | null, label: string) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "primary", size: "lg" }), "flex-1")}>
        {label}
      </a>
    ) : null;

  if (!status) {
    if (error) {
      return (
        <section className={shell}>
          <Head meta="Not linked" />
          <p className="m-0 text-sm leading-normal" role="alert">{error}</p>
          <div className="flex gap-2">
            <Button type="button" variant="primary" size="lg" className="flex-1" onClick={() => void read()}>
              Try again
            </Button>
          </div>
        </section>
      );
    }
    return (
      <section className={shell} aria-busy="true" aria-label="Loading WhatsApp">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-control" />
          <div className="flex-1">
            <Skeleton className="h-[18px] w-3/5" />
            <Skeleton className="mt-2 h-[13px] w-2/5" />
          </div>
        </div>
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-12 rounded-control" />
      </section>
    );
  }

  const unlinkButton = (
    <Button type="button" variant="quiet" size="text" disabled={busy} onClick={() => void removeLink()}>
      Unlink
    </Button>
  );
  const errorLine = error ? (
    <p className="m-0 text-sm leading-normal" role="alert">
      {error}
    </p>
  ) : null;

  if (status.linked && status.optedOut) {
    return (
      <section className={shell}>
        <Head meta="Stopped from WhatsApp" />
        <p className="m-0 text-base leading-normal">You wrote stop. Nothing is sent until you write start.</p>
        {errorLine}
        <div className="flex items-center gap-2">
          {open(status.chatUrl, "Open WhatsApp")}
          {unlinkButton}
        </div>
      </section>
    );
  }

  if (status.linked) {
    const paused = status.pausedUntil ? new Date(status.pausedUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null;
    return (
      <section className={shell}>
        <Head meta={paused ? `Paused until ${paused}` : (status.phoneMasked ?? "Linked")} />
        {paused ? <p className="m-0 text-sm text-muted-foreground">{status.phoneMasked}</p> : null}
        <Rows morningAt={status.morningAt} dropsPerDay={status.dropsPerDay} />
        {paused ? <p className="m-0 text-base leading-normal text-muted-foreground">Nothing is sent until then. Write to us any time and we answer.</p> : null}
        {errorLine}
        <div className="flex items-center justify-end gap-2">{unlinkButton}</div>
      </section>
    );
  }

  if (code) {
    return (
      <section className={shell}>
        <Head meta="Not linked yet" />
        <p className="m-0 text-base leading-normal">Send the message WhatsApp opened.</p>
        <div className="rounded-control bg-sunk p-4">
          <span className="text-sm text-muted-foreground">Or send this yourself. Valid for 15 minutes.</span>
          <b className="mt-1 block text-2xl font-semibold tabular-nums">Join {code.code}</b>
        </div>
        <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <span className="size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-r-transparent motion-reduce:animate-none" aria-hidden="true" />
          Waiting for your message
        </p>
        {errorLine}
        <div className="flex items-center gap-2">
          {open(code.url, "Open WhatsApp again")}
          <Button type="button" variant="quiet" size="text" onClick={() => setCode(null)}>
            Cancel
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className={shell}>
      <Head meta="Not linked" />
      <p className="m-0 text-base leading-normal">Get your day&apos;s jobs in WhatsApp, apply with a tap and answer questions there.</p>
      {errorLine}
      <div className="flex gap-2">
        <Button type="button" variant="primary" size="lg" className="flex-1" disabled={busy} onClick={() => void start()}>
          Open WhatsApp
        </Button>
      </div>
    </section>
  );
}
