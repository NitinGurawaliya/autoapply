"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SegmentedProgress } from "@/components/ui/segmented-progress";
import { explainOutcome } from "@/lib/explain";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "failed" } | { kind: "stopped"; headline: string; next: string | null };

/**
 * Hands the job to the agent for someone with a profile (Phase U5, design/share.html 9): on load when they come back
 * from Google or onboarding with this job's intent (`auto`), else on the Apply tap. Sent: the application page opens.
 * Stopped by a rule with an application to show: this page again, which reads the outcome. Otherwise said here.
 */
export function ShareClaim({ jobId, path, auto }: { jobId: string; path: string; auto: boolean }) {
  const [state, setState] = useState<State>(auto ? { kind: "sending" } : { kind: "idle" });
  const started = useRef(false);
  // A press of Apply or Try again: the funnel counts it as the tap (U7), the claim on load is not one.
  const tapped = useRef(false);

  const claim = useCallback(async () => {
    setState({ kind: "sending" });
    let response: Response;
    try {
      response = await fetch("/api/share/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, auto: auto && !tapped.current }) });
    } catch {
      setState({ kind: "failed" });
      return;
    }
    const body = (await response.json().catch(() => ({}))) as { applicationId?: string | null; blocked?: string; error?: string };
    // Full loads: the application page starts its own polling, and this page reads the stored outcome.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load on purpose (above)
    if (response.ok && body.applicationId) return window.location.assign(`/applications/${body.applicationId}?from=share`);
    if (response.status === 403 && body.applicationId) return window.location.assign(path);
    if (response.status === 403 && body.blocked === "job_closed") return window.location.assign(path);
    if (response.status === 403 && body.blocked) {
      const outcome = explainOutcome("blocked", body.blocked);
      return setState({ kind: "stopped", headline: outcome.headline, next: outcome.next });
    }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load: onboarding reads the intent on the server
    if (response.status === 400 && body.error === "profile_required") return window.location.assign("/onboarding/resume");
    if (response.status === 401) return window.location.assign(path);
    setState({ kind: "failed" });
  }, [jobId, path, auto]);

  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    void claim();
  }, [auto, claim]);

  if (state.kind === "sending") {
    return (
      <div className="flex h-14 flex-col justify-center gap-2.5" role="status" aria-live="polite">
        <SegmentedProgress count={3} done={1} className="animate-pulse" />
        <span className="type-body font-medium">Sending to your agent</span>
      </div>
    );
  }
  if (state.kind === "stopped") {
    return (
      <div className="flex flex-col gap-1" role="status">
        <p className="m-0 type-section">{state.headline}</p>
        {state.next ? <p className="m-0 type-body text-pretty text-muted-foreground">{state.next}</p> : null}
      </div>
    );
  }
  return (
    <>
      {state.kind === "failed" ? (
        <p className="m-0 mb-2.5 type-body text-pretty" role="alert">
          That didn&apos;t go through. Nothing was sent.
        </p>
      ) : null}
      <Button
        variant="primary"
        size="xl"
        className="w-full"
        onClick={() => {
          tapped.current = true;
          void claim();
        }}
      >
        {state.kind === "failed" ? "Try again" : "Apply"}
      </Button>
      {state.kind === "idle" ? <p className="m-0 mt-2 text-center type-meta text-muted-foreground">Your agent applies with your saved profile.</p> : null}
    </>
  );
}
