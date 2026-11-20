"use client";

import { forgetVisitedPages } from "@/lib/forget-pages";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FieldError } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/segmented-progress";
import { InfoNote } from "@/components/patterns/content";
import { ResumeSketch } from "@/components/patterns/drawings";
import { PageIntro, ScreenBody, StepHeader, StickyFooter } from "@/components/patterns/layout";

/** What the upload's refusal (api/profile/resume, modules/profile/parseResume.ts) means to the user. */
const UPLOAD_ERRORS: Record<string, string> = {
  no_text: "This PDF has no text we can read (it may be a scan). Export your resume as a text PDF and try again.",
  nothing_found: "We couldn't find your work, skills or education in this PDF. Check it's your resume and try again.",
  no_name: "We couldn't find your name on this resume. Add it to the PDF and try again.",
  parse_failed: "We could not read your resume just now. Try again in a minute.",
  read_failed: "We could not read your resume just now. Try again in a minute.",
  rate_limited: "Too many uploads in the last hour. Try again later.",
};

/** How long a read usually takes (18 s measured on 21 Nov): the bar fills towards it and never claims to be done. */
const TYPICAL_MS = 20_000;

/**
 * Step 1 of onboarding (Phase S, docs/onboarding/TDD.md 3): pick a PDF and it is read at once (no second button), then
 * straight on to the profile screen, which shows what was found (no findings screen of its own). The wait shows the
 * page being read and a bar that fills with time, so it never looks stuck. The upload is POST /api/profile/resume.
 */
export function ResumeUploadForm({ signOut }: { signOut: React.ReactNode }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");

  // The band sweeps the page and the bar creeps on while we read.
  useEffect(() => {
    if (!reading) return;
    const timer = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(timer);
  }, [reading]);

  async function read(file: File) {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setError("Choose a PDF resume.");
      return;
    }
    setError("");
    setStarted(Date.now());
    setNow(Date.now());
    setReading(true);
    const body = new FormData();
    body.set("resume", file);
    const response = await fetch("/api/profile/resume", { method: "POST", body }).catch(() => null);
    if (!response?.ok) {
      setReading(false);
      if (input.current) input.current.value = "";
      const code = response ? ((await response.json().catch(() => null)) as { error?: string } | null)?.error : null;
      setError((code && UPLOAD_ERRORS[code]) || "Could not read that PDF. Try another file.");
      return;
    }
    // A replaced resume's changes, for the profile screen (sessionStorage: it may be unavailable, then nothing shows).
    const result = (await response.json().catch(() => null)) as { changes?: { replaced?: boolean } } | null;
    try {
      if (result?.changes?.replaced) sessionStorage.setItem("resume-changes", JSON.stringify(result.changes));
      else sessionStorage.removeItem("resume-changes");
    } catch {
      /* private mode: the profile screen shows the profile without the summary */
    }
    void forgetVisitedPages(); // a new resume changes the feed
    router.push("/onboarding/confirm");
  }

  if (reading) {
    const elapsed = Math.max(0, now - started);
    // Up to 90 % over the usual time, then slower: honest about the wait without a fake finish.
    const value = elapsed < TYPICAL_MS ? (elapsed / TYPICAL_MS) * 90 : 90 + Math.min(8, (elapsed - TYPICAL_MS) / 2000);
    return (
      <>
        <StepHeader step={1} of={2} />
        <ScreenBody>
          <PageIntro title="Reading your resume" sub={elapsed > TYPICAL_MS + 5000 ? "Almost there. Long resumes take a little longer." : "Your work, skills and education. Usually under 20 seconds."} />
          <ResumeSketch band={Math.floor(elapsed / 1100)} />
          <div className="mt-auto flex flex-col gap-2.5 pt-6" aria-live="polite">
            <ProgressBar value={value} />
            <span className="text-center type-meta text-muted-foreground">Next, you check what we found</span>
          </div>
        </ScreenBody>
      </>
    );
  }

  return (
    <>
      <StepHeader step={1} of={2} />
      <ScreenBody>
        <PageIntro title="Start with your resume" sub="We read it once, so you never retype your details again." />
        <input
          ref={input}
          id="resume"
          name="resume"
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          aria-label="Resume PDF"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void read(file);
          }}
        />
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="mt-7 box-border flex h-70 cursor-pointer flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line-strong bg-surface text-foreground"
        >
          <span className="box-border flex size-14 items-center justify-center rounded-control bg-primary text-primary-foreground">
            <Icon name="upload" size={30} />
          </span>
          <span className="mt-1 text-lg font-semibold">Upload your resume</span>
          <span className="text-sm text-muted-foreground">PDF, up to 5 MB</span>
        </button>
        <InfoNote className="mt-4.5">Private to you. Used only for jobs you swipe right on.</InfoNote>
        {error ? <FieldError className="mt-4">{error}</FieldError> : null}
      </ScreenBody>
      <StickyFooter>
        <div className="flex justify-center">{signOut}</div>
      </StickyFooter>
    </>
  );
}
