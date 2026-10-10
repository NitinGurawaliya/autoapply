"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApplicationActions } from "@/components/application-actions";
import { buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Eyebrow, Skeleton } from "@/components/ui/eyebrow";
import { FieldError } from "@/components/ui/field";
import { EmptyState } from "@/components/patterns/content";
import { DeckDoneArt, DeckEmptyArt } from "@/components/patterns/drawings";
import { FailedRow, NeedsRow, ProgressRow, SentRow } from "@/components/patterns/application-row";
import { explainOutcome } from "@/lib/explain";
import { GROUP_TABS, STAGES, statusMeta, type StatusGroup } from "@/lib/status-meta";

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

type Tab = "all" | StatusGroup;

const RUNNING = ["queued", "inspecting", "filling"];
const SECTION_TITLE: Record<StatusGroup, string> = { needs: "Needs you", progress: "In progress", sent: "Sent", failed: "Didn't go through" };
const SECTION_ORDER: StatusGroup[] = ["needs", "progress", "sent", "failed"];

/** "4m ago", "2h ago", "3d ago". */
function short(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** "today, 10:42", "yesterday", "8 Oct". */
function day(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  if (date.getTime() >= startOfToday) return `today, ${time}`;
  if (date.getTime() >= startOfToday - 86_400_000) return "yesterday";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function progressLabel(row: Row) {
  const stage = statusMeta(row.status).stage ?? 0;
  if (row.status === "queued" && row.ahead != null) return `${STAGES[0]} · ${row.ahead === 0 ? "you are next" : `${row.ahead} ahead`}`;
  return STAGES[stage];
}

export function ApplicationsList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
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
      <div className="px-5 pt-4">
        <FieldError>Could not load your applications. Refresh to try again.</FieldError>
      </div>
    );
  }
  if (!rows) {
    return (
      <div className="flex flex-col gap-3 px-5 pt-4" aria-busy="true" aria-label="Loading your applications">
        <div className="flex gap-2">
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} className="h-10 w-24 rounded-full" />
          ))}
        </div>
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-24 rounded-[18px]" />
        ))}
      </div>
    );
  }

  const changed = () => setVersion((value) => value + 1);
  const groups = Object.fromEntries(SECTION_ORDER.map((group) => [group, rows.filter((row) => statusMeta(row.status).group === group)])) as Record<
    StatusGroup,
    Row[]
  >;
  const counts: Record<Tab, number> = { all: rows.length, needs: groups.needs.length, progress: groups.progress.length, sent: groups.sent.length, failed: groups.failed.length };
  const sections = SECTION_ORDER.filter((group) => (tab === "all" || tab === group) && groups[group].length > 0);

  function rowFor(row: Row) {
    const href = `/applications/${row.id}`;
    const group = statusMeta(row.status).group;
    if (group === "needs") {
      const code = row.waitingFor === "code";
      return (
        <NeedsRow
          key={row.id}
          href={href}
          company={row.company}
          role={row.title}
          when={short(row.createdAt)}
          ask={code ? "Their job board emailed you a code." : "Their form asked something only you can answer."}
          cta={code ? "Enter code" : "Answer"}
          actions={<ApplicationActions id={row.id} status={row.status} company={row.company} onChanged={changed} />}
        />
      );
    }
    if (group === "progress") {
      return (
        <ProgressRow
          key={row.id}
          href={href}
          company={row.company}
          role={row.title}
          stage={statusMeta(row.status).stage ?? 0}
          label={progressLabel(row)}
          actions={<ApplicationActions id={row.id} status={row.status} company={row.company} onChanged={changed} />}
        />
      );
    }
    if (group === "sent") return <SentRow key={row.id} href={href} company={row.company} role={row.title} when={day(row.submittedAt ?? row.createdAt)} />;
    const outcome = explainOutcome(row.status, row.error, row.waitingFor);
    return (
      <FailedRow
        key={row.id}
        href={href}
        company={row.company}
        role={row.title}
        reason={outcome.headline}
        action={["failed", "cancelled"].includes(row.status) ? <ApplicationActions id={row.id} status={row.status} company={row.company} onChanged={changed} /> : undefined}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="group" aria-label="Show" className="flex flex-none gap-2 overflow-x-auto px-5 pt-4 pb-3">
        {GROUP_TABS.map((item) => (
          <Chip key={item.id} shape="tab" selected={tab === item.id} count={counts[item.id]} onClick={() => setTab(item.id)}>
            {item.label}
          </Chip>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          art={<DeckEmptyArt />}
          title="No applications yet"
          text="Swipe right on a job and it shows up here, with everything we filled in."
          actions={
            <Link href="/feed" className={buttonVariants({ variant: "primary", size: "xl", className: "w-full" })}>
              Go to the feed
            </Link>
          }
        />
      ) : sections.length === 0 ? (
        <EmptyState
          art={<DeckDoneArt />}
          title="Nothing here"
          text="No applications in this group right now."
          actions={
            <Button variant="line" size="lg" className="w-full" onClick={() => setTab("all")}>
              Show all
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-[22px] px-5 pt-1 pb-6">
          {sections.map((group) => (
            <section key={group} className="flex flex-col gap-2.5" aria-label={SECTION_TITLE[group]}>
              <Eyebrow as="h2">
                {SECTION_TITLE[group]} · {groups[group].length}
              </Eyebrow>
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">{groups[group].map(rowFor)}</ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
