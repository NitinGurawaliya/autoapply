"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckRow } from "@/components/ui/check-row";
import { FieldError } from "@/components/ui/field";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { AgentStatus } from "@/components/patterns/agent-status";
import { InfoNote } from "@/components/patterns/content";
import type { ConnectionView, SourcesOverview } from "@/modules/sources";
import { SignInStream } from "./sign-in-stream";

// The user's own job-site accounts (Phase K, docs/naukri/TDD.md 5, 13.12): connect by signing in themselves on the
// site's own page, streamed here from a browser we run (K8), see where it stands, disconnect.

const POLL_MS = 3000;

const REFUSED: Record<string, string> = {
  test_profile_mock_only: "Test profiles cannot connect a job site.",
  profile_required: "Finish setting up your profile first.",
  no_screen_worker: "Sign-in is not available right now. Try again in a few minutes.",
  already_connecting: "A sign-in is already open. Continue it instead.",
  rate_limited: "Too many tries. Wait a little and connect again.",
};

const FETCH_REFUSED: Record<string, string> = {
  not_connected: "Connect the account first.",
  no_screen_worker: "Start the worker on your computer first: your agent looks in a Chrome window there.",
  daily_limit: "Your agent has already looked as often as it may today. It looks again tomorrow.",
  rate_limited: "Your agent looked a short while ago. Try again in a few hours.",
};

function ago(iso: string | null) {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function until(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

/** The status line under the site's name, in the agent's words. */
function statusLine(site: ConnectionView) {
  switch (site.status) {
    case "connected":
      return `${site.accountLabel ? `Connected as ${site.accountLabel}` : "Connected"} · ${site.lastIngestAt ? `looked for jobs ${ago(site.lastIngestAt)}` : "no jobs read yet"}`;
    case "needs_signin":
      return `${site.label} signed you out. Sign in again so your agent can keep going.`;
    case "limited":
      return `${site.label} asked for a check, so your agent paused until ${until(site.pausedUntil)}.`;
    case "failed":
      return site.lastError ?? "The last sign-in did not finish.";
    case "connecting":
      return "Waiting for you to sign in";
    default:
      return "Not connected";
  }
}

export function ConnectedSites({ initial }: { initial: SourcesOverview }) {
  const [overview, setOverview] = useState(initial);
  const [sheetFor, setSheetFor] = useState<ConnectionView | null>(null);
  const [streamFor, setStreamFor] = useState<ConnectionView | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/sources", { cache: "no-store" }).catch(() => null);
    if (response?.ok) setOverview((await response.json()) as SourcesOverview);
  }, []);

  // Polls only while a sign-in window is open, and not while the tab is hidden.
  const waiting = overview.sites.some((site) => site.status === "connecting");
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  async function connect(site: ConnectionView) {
    setBusy(site.site);
    setError("");
    try {
      const response = await fetch(`/api/sources/${site.site}/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true }) });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(REFUSED[body.error ?? ""] ?? "Could not open the sign-in. Try again.");
      }
      setSheetFor(null);
      setAgreed(false);
      setStreamFor(site);
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not open the sign-in. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function fetchNow(site: ConnectionView) {
    setBusy(site.site);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/sources/${site.site}/ingest`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(FETCH_REFUSED[body.error ?? ""] ?? "Could not start. Try again.");
      }
      setNotice(`Your agent is looking on ${site.label} now, in the Chrome window on your computer. New jobs reach your feed in a few minutes.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not start. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(site: ConnectionView) {
    setBusy(site.site);
    setError("");
    try {
      const response = await fetch(`/api/sources/${site.site}/disconnect`, { method: "POST" });
      if (!response.ok) throw new Error(`Could not disconnect ${site.label}. Try again.`);
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not disconnect. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function openSheet(site: ConnectionView) {
    setError("");
    setAgreed(false);
    setSheetFor(site);
  }

  return (
    <section className="box-border flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 type-section">Your job site accounts</h2>
        <p className="m-0 text-sm leading-normal text-muted-foreground">Connect your own account and your agent finds jobs there and applies when you swipe right.</p>
      </div>
      {overview.sites.map((site) => {
        const linked = site.status === "connected" || site.status === "limited";
        return (
          <div key={site.site} className="flex flex-col gap-2.5 border-t border-line pt-3">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="flex size-10 flex-none items-center justify-center rounded-control border border-line bg-subtle type-body font-semibold">
                {site.label.charAt(0)}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="type-body font-semibold">{site.label}</span>
                {site.status === "connecting" ? null : <span className="type-meta text-muted-foreground">{statusLine(site)}</span>}
              </span>
            </div>
            {site.status === "connecting" ? <AgentStatus text="Waiting for you to sign in" size={32} /> : null}
            {linked ? (
              <div className="flex flex-col gap-2">
                {site.status === "connected" ? (
                  <Button type="button" variant="primary" size="lg" className="w-full" disabled={busy === site.site} onClick={() => void fetchNow(site)}>
                    {`Find ${site.label} jobs now`}
                  </Button>
                ) : null}
                <Button type="button" variant="line" size="lg" className="w-full" disabled={busy === site.site} onClick={() => void disconnect(site)}>
                  {`Disconnect ${site.label}`}
                </Button>
              </div>
            ) : site.status === "connecting" ? (
              <div className="flex flex-col gap-2">
                <Button type="button" variant="primary" size="lg" className="w-full" onClick={() => setStreamFor(site)}>
                  Continue signing in
                </Button>
                <Button type="button" variant="quiet" size="lg" className="w-full" disabled={busy === site.site} onClick={() => void disconnect(site)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button type="button" variant="primary" size="lg" className="w-full" disabled={!overview.canConnect} onClick={() => openSheet(site)}>
                {site.status === "needs_signin" ? "Sign in again" : `Connect ${site.label}`}
              </Button>
            )}
          </div>
        );
      })}
      {!overview.canConnect ? <InfoNote size="sm">Test profiles cannot connect a job site.</InfoNote> : null}
      {notice ? <InfoNote size="sm">{notice}</InfoNote> : null}
      {error && !sheetFor ? <FieldError>{error}</FieldError> : null}

      <Sheet open={sheetFor !== null} onOpenChange={(open) => (open ? undefined : setSheetFor(null))}>
        <SheetContent aria-label={sheetFor ? `Connect ${sheetFor.label}` : "Connect"}>
          {sheetFor ? (
            <div className="flex flex-col gap-4 pt-4">
              <SheetTitle className="m-0 type-heading">Connect {sheetFor.label}</SheetTitle>
              <SheetDescription className="m-0 flex flex-col gap-2.5 text-sm leading-normal text-muted-foreground">
                <span>
                  Your agent will use your {sheetFor.label} account to find jobs for you and to apply when you swipe right. It reads job listings and your own profile only, never other people&apos;s profiles or messages.
                </span>
                <span>It applies one job at a time, at a person&apos;s pace, and stops the moment {sheetFor.label} asks for a check.</span>
                <span>
                  You connect with your mobile number and the code {sheetFor.label} texts you. We enter them on {sheetFor.label}&apos;s own login for you and never ask for your password. The code is used once and not kept; your number is kept, encrypted, for the next time.
                </span>
                <span>After that we keep you signed in and use the account from our servers, through a home internet address in your city, until you disconnect.</span>
                <span>
                  {sheetFor.label}&apos;s terms do not allow automated use, and {sheetFor.label} may limit or suspend accounts it finds automated. Disconnect at any time: it deletes the saved sign-in.
                </span>
              </SheetDescription>
              <CheckRow title={`I understand ${sheetFor.label} may limit or suspend accounts it finds automated`} checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
              {!overview.screenWorkerAlive ? <InfoNote size="sm">{REFUSED.no_screen_worker}</InfoNote> : null}
              {error ? <FieldError>{error}</FieldError> : null}
              <div className="flex flex-col gap-2">
                <Button type="button" variant="primary" size="xl" className="w-full" disabled={!agreed || !overview.screenWorkerAlive || busy === sheetFor.site} onClick={() => void connect(sheetFor)}>
                  {busy === sheetFor.site ? "Opening..." : `Continue to ${sheetFor.label} sign-in`}
                </Button>
                <Button type="button" variant="quiet" size="lg" className="w-full" onClick={() => setSheetFor(null)}>
                  Not now
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={streamFor !== null} onOpenChange={(open) => (open ? undefined : setStreamFor(null))}>
        <SheetContent aria-label={streamFor ? `Sign in to ${streamFor.label}` : "Sign in"}>
          {streamFor ? (
            <SignInStream
              site={streamFor.site}
              label={streamFor.label}
              onSettled={() => void refresh()}
              onClose={() => {
                setStreamFor(null);
                void refresh();
              }}
              onCancel={() => {
                const site = streamFor;
                setStreamFor(null);
                void disconnect(site);
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}
