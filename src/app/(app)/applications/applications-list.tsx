"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { ApplicationActions } from "@/components/application-actions";
import { CompanyAvatar } from "@/components/company-avatar";
import { StatusBadge } from "@/components/status-badge";
import { explainOutcome, type Tone } from "@/lib/explain";

type Row = {
  id: string;
  status: string;
  error: string | null;
  title: string;
  company: string;
  location: string;
  submittedAt: string | null;
  createdAt: string;
  waitingFor: "code" | "answers" | null;
  ahead?: number | null;
};

const TILES = [
  { id: "submitted", label: "Submitted", hint: "Applications that went through", style: "bg-success-soft text-success", match: (s: string) => s === "submitted" },
  { id: "active", label: "In progress", hint: "Queued or running", style: "bg-info-soft text-info", match: (s: string) => ["queued", "inspecting", "filling"].includes(s) },
  { id: "waiting", label: "Needs you", hint: "Waiting for your answer or code", style: "bg-warning-soft text-warning", match: (s: string) => s === "needs_input" },
  { id: "problem", label: "Failed", hint: "Failed, blocked or cancelled", style: "bg-danger-soft text-danger", match: (s: string) => ["failed", "blocked", "cancelled"].includes(s) },
] as const;

type TileId = (typeof TILES)[number]["id"];

const RUNNING = ["queued", "inspecting", "filling"];
const TONE_TEXT: Record<Tone, string> = {
  success: "text-success",
  info: "text-info",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-muted-foreground",
};

function ago(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function ApplicationsList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<TileId | null>(null);
  // Bumped after a cancel or retry so the list reloads and starts polling again.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    async function load() {
      try {
        const response = await fetch("/api/applications", { cache: "no-store" });
        if (!response.ok) throw new Error("bad status");
        const body = (await response.json()) as { applications: Row[] };
        if (stopped) return;
        setRows(body.applications);
        setFailed(false);
        // Keep polling only while something is still running.
        if (body.applications.some((row) => RUNNING.includes(row.status))) timer = window.setTimeout(load, 3000);
      } catch {
        if (!stopped) setFailed(true);
      }
    }

    void load();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [version]);

  if (failed && !rows) {
    return (
      <p className="rounded-xl border border-border bg-card px-3 py-6 text-sm text-destructive">
        Could not load your applications. Refresh to try again.
      </p>
    );
  }
  if (!rows) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your applications">
        <div className="grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="h-16 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        {[0, 1, 2].map((n) => (
          <div key={n} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  const active = TILES.find((tile) => tile.id === filter) ?? null;
  const shown = active ? rows.filter((row) => active.match(row.status)) : rows;
  const counts = Object.fromEntries(TILES.map((tile) => [tile.id, rows.filter((row) => tile.match(row.status)).length]));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Summary. Tap one to filter">
        {TILES.map((tile) => {
          const pressed = filter === tile.id;
          return (
            <button
              key={tile.id}
              type="button"
              aria-pressed={pressed}
              title={tile.hint}
              onClick={() => setFilter(pressed ? null : tile.id)}
              className={`flex flex-col-reverse items-start gap-0.5 rounded-xl p-2.5 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-ring ${tile.style} ${
                pressed ? "ring-2 ring-current" : filter ? "opacity-60" : ""
              }`}
            >
              <span className="text-[11px] font-medium leading-tight">{tile.label}</span>
              <span className="text-xl font-semibold leading-none">{counts[tile.id]}</span>
            </button>
          );
        })}
      </div>

      {active ? (
        <div className="-mt-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {shown.length} {active.label.toLowerCase()}
          </span>
          <button type="button" onClick={() => setFilter(null)} className="underline underline-offset-4">
            Show all
          </button>
        </div>
      ) : null}

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-card">
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <ClipboardList className="size-6" aria-hidden />
          </span>
          <h2 className="text-base font-semibold">{rows.length === 0 ? "No applications yet" : "Nothing here"}</h2>
          <p className="max-w-[30ch] text-sm text-muted-foreground">
            {rows.length === 0 ? "Swipe right on a job in the feed and it shows up here, with everything we filled in." : "No applications in this group right now."}
          </p>
          {rows.length === 0 ? (
            <Link href="/feed" className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Go to the feed
            </Link>
          ) : (
            <button type="button" onClick={() => setFilter(null)} className="rounded-full border border-border px-4 py-2 text-sm">
              Show all
            </button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((row) => {
            const outcome = explainOutcome(row.status, row.error, row.waitingFor);
            const showOutcome = row.status !== "submitted";
            return (
              <li key={row.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
                <Link href={`/applications/${row.id}`} className="flex flex-col gap-2.5 p-4 transition-colors hover:bg-accent/40">
                  <div className="flex items-start gap-3">
                    <CompanyAvatar name={row.company} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug">{row.title}</p>
                      <p className="truncate text-sm text-muted-foreground">{row.company}</p>
                    </div>
                    <StatusBadge status={row.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.location ? `${row.location} · ` : ""}
                    {row.submittedAt ? `Submitted ${ago(row.submittedAt)}` : `Started ${ago(row.createdAt)}`}
                  </p>
                  {showOutcome ? (
                    <p className="text-xs leading-relaxed">
                      <span className={`font-semibold ${TONE_TEXT[outcome.tone]}`}>{outcome.headline}.</span>{" "}
                      {outcome.next ? <span className="text-muted-foreground">{outcome.next}</span> : null}
                      {row.status === "queued" && row.ahead != null ? <span className="text-muted-foreground"> {row.ahead === 0 ? "You are next." : `${row.ahead} ahead of this one.`}</span> : null}
                    </p>
                  ) : null}
                </Link>
                {["queued", "inspecting", "filling", "needs_input", "failed", "cancelled"].includes(row.status) ? (
                  <div className="flex justify-end border-t border-border px-4 py-2">
                    <ApplicationActions id={row.id} status={row.status} company={row.company} onChanged={() => setVersion((v) => v + 1)} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
