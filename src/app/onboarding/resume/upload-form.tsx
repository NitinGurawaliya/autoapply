"use client";

import { forgetVisitedPages } from "@/lib/forget-pages";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/segmented-progress";
import { InfoNote } from "@/components/patterns/content";
import { ResumeSketch } from "@/components/patterns/drawings";
import { PageIntro, ScreenBody, StepHeader, StickyFooter } from "@/components/patterns/layout";

type Profile = {
  fullName: string;
  phone: string | null;
  yearsExperience: number | null;
  skills: string[];
  experience: Array<{ title: string }>;
  education: Array<{ school: string; degree: string | null }>;
};

type Find = { label: string; value: string; missing?: boolean };

function findsOf(profile: Profile): Find[] {
  const roles = profile.experience.length;
  const years = profile.yearsExperience;
  const skills = profile.skills;
  const school = profile.education[0];
  return [
    { label: "Name", value: profile.fullName || "Not found. You can add it next", missing: !profile.fullName },
    {
      label: "Experience",
      value:
        roles === 0
          ? "Not found. You can add it next"
          : `${years != null ? `${years} ${years === 1 ? "year" : "years"} across ` : ""}${roles} ${roles === 1 ? "role" : "roles"}`,
      missing: roles === 0,
    },
    {
      label: "Skills",
      value: skills.length === 0 ? "Not found. You can add them next" : skills.length > 3 ? `${skills.slice(0, 3).join(", ")} and ${skills.length - 3} more` : skills.join(", "),
      missing: skills.length === 0,
    },
    {
      label: "Education",
      value: school ? [school.degree, school.school].filter(Boolean).join(", ") : "Not found. You can add it next",
      missing: !school,
    },
    { label: "Phone", value: profile.phone || "Not found. You can add it next", missing: !profile.phone },
  ];
}

const LABELS = ["Name", "Experience", "Skills", "Education", "Phone"];

/**
 * Step 1 of onboarding (design/onboarding.html): choose a PDF, then watch it being read. The upload is the same
 * POST /api/profile/resume as before; once it is read, the findings come from GET /api/profile.
 */
export function ResumeUploadForm({ signOut }: { signOut: React.ReactNode }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [view, setView] = useState<"upload" | "reading">("upload");
  const [finds, setFinds] = useState<Find[] | null>(null);
  const [shown, setShown] = useState(0);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");

  // The lime band sweeps the page while we read.
  useEffect(() => {
    if (view !== "reading" || (finds && shown >= finds.length)) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1100);
    return () => window.clearInterval(timer);
  }, [view, finds, shown]);

  // Findings appear one by one once they are in.
  useEffect(() => {
    if (!finds || shown >= finds.length) return;
    const timer = window.setTimeout(() => setShown((value) => value + 1), 450);
    return () => window.clearTimeout(timer);
  }, [finds, shown]);

  async function read() {
    if (!file) {
      setError("Choose a PDF resume.");
      return;
    }
    setError("");
    setFinds(null);
    setShown(0);
    setView("reading");
    const body = new FormData();
    body.set("resume", file);
    const response = await fetch("/api/profile/resume", { method: "POST", body }).catch(() => null);
    if (!response?.ok) {
      setView("upload");
      const code = response ? ((await response.json().catch(() => null)) as { error?: string } | null)?.error : null;
      setError(
        code === "no_text"
          ? "This PDF has no text we can read (it may be a scan). Export your resume as a text PDF and try again."
          : code === "parse_failed" || code === "read_failed"
            ? "We could not read your resume just now. Try again in a minute."
            : code === "rate_limited"
              ? "Too many uploads in the last hour. Try again later."
              : "Could not read that PDF. Try another file.",
      );
      return;
    }
    void forgetVisitedPages(); // a new resume changes the feed
    const profile = await fetch("/api/profile", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<Profile>) : null))
      .catch(() => null);
    setFinds(profile ? findsOf(profile) : LABELS.map((label) => ({ label, value: "Read" })));
  }

  const done = Boolean(finds && shown >= finds.length);
  const missing = finds?.filter((find) => find.missing).length ?? 0;

  if (view === "reading") {
    return (
      <>
        <StepHeader step={1} />
        <ScreenBody>
          <PageIntro
            title={done ? "Got it" : "Reading your resume"}
            sub={
              done
                ? `${(finds?.length ?? 0) - missing} things found${missing ? `, ${missing} to add` : ""}. Have a quick look before we start.`
                : "Usually takes 5 to 15 seconds."
            }
          />
          <ResumeSketch band={tick} />
          <ul className="m-0 mt-6 flex list-none flex-col gap-1 p-0" aria-live="polite">
            {LABELS.map((label, index) => {
              const find = finds && index < shown ? finds[index] : null;
              return (
                <li
                  key={label}
                  className={cn(
                    "flex min-h-12 items-center gap-3 transition-[opacity,transform] duration-[420ms] ease-pop",
                    find ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-40",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "box-border flex size-7 flex-none items-center justify-center rounded-full border-2",
                      !find && "border-sketch-line bg-transparent",
                      find && !find.missing && "border-primary-edge bg-primary text-ink",
                      find?.missing && "border-foreground bg-transparent text-foreground",
                    )}
                  >
                    {find && !find.missing ? <Icon name="check" size={14} strokeWidth={3.5} /> : null}
                    {find?.missing ? <span className="text-sm font-extrabold">!</span> : null}
                  </span>
                  <div className="flex flex-col gap-px">
                    <span className="text-[13px] text-muted-foreground">{label}</span>
                    <span className="text-[15px] font-semibold">{find ? find.value : "Looking…"}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-auto pt-6">
            {done ? (
              <Button variant="primary" size="xl" className="w-full" onClick={() => router.push("/onboarding/confirm")}>
                Check what we found
              </Button>
            ) : (
              <div className="flex flex-col gap-2.5">
                <ProgressBar value={finds ? 40 + (shown / finds.length) * 60 : Math.min(36, 8 + tick * 6)} />
                <span className="text-center text-sm text-muted-foreground">
                  Found {shown} of {LABELS.length} · keep this screen open
                </span>
              </div>
            )}
          </div>
        </ScreenBody>
      </>
    );
  }

  return (
    <>
      <StepHeader step={1} />
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
            setFile(event.target.files?.[0] ?? null);
            setError("");
          }}
        />
        {file ? (
          <div className="mt-7 box-border flex items-center gap-3.5 rounded-panel border-2 border-edge bg-surface p-4 shadow-hard">
            <span aria-hidden="true" className="flex size-12 flex-none items-center justify-center rounded-tile bg-inverse text-xs font-bold tracking-[0.04em] text-inverse-foreground">
              PDF
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-base font-semibold">{file.name}</span>
              <span className="text-[13px] text-muted-foreground">{Math.max(1, Math.round(file.size / 1024))} KB · Ready to read</span>
            </div>
            <Button variant="underline" size="text" className="text-sm" onClick={() => input.current?.click()}>
              Replace
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="mt-7 box-border flex h-[280px] cursor-pointer flex-col items-center justify-center gap-3 rounded-[24px] border-2 border-dashed border-edge bg-surface text-foreground"
          >
            <span className="box-border flex size-18 items-center justify-center rounded-full border-2 border-primary-edge bg-primary text-ink">
              <Icon name="upload" size={30} />
            </span>
            <span className="mt-1 text-lg font-semibold">Upload your resume</span>
            <span className="text-sm text-muted-foreground">PDF, up to 5 MB</span>
          </button>
        )}
        <InfoNote className="mt-[18px]">Private to you. Used only for jobs you swipe right on.</InfoNote>
        {error ? <FieldError className="mt-4">{error}</FieldError> : null}
      </ScreenBody>
      <StickyFooter>
        <Button variant="primary" size="xl" className="w-full" disabled={!file} onClick={() => void read()}>
          Read my resume
        </Button>
        <div className="mt-2 flex justify-center">{signOut}</div>
      </StickyFooter>
    </>
  );
}
