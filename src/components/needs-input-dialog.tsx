"use client";

import { joinChoices, splitChoices } from "@/lib/choices";
import { forgetVisitedPages } from "@/lib/forget-pages";
import { useEffect, useState } from "react";
import { useApplicationsSummary } from "@/components/applications-summary";
import { Button } from "@/components/ui/button";
import { AccentPill, Chip } from "@/components/ui/chip";
import { FieldError, InputBox, NativeSelect, TextAreaBox } from "@/components/ui/field";
import { CompanyMark } from "@/components/ui/marks";
import { OtpInput } from "@/components/ui/otp-input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { InfoNote } from "@/components/patterns/content";

type PendingQuestion = {
  key: string;
  label: string;
  type: string;
  options?: string[];
  required: boolean;
};

type Waiting = {
  id: string;
  company: string;
  title: string;
  questions: PendingQuestion[];
};

const CODE_KEY = "security_code";
// Greenhouse's emailed security codes are 8 characters, letters and digits.
const CODE_LENGTH = 8;
// Up to this many options are shown as answer buttons (design/feed.html "Yes / No"); more use a picker.
const MAX_ANSWER_BUTTONS = 4;

/**
 * The "agent needs you" sheet (design/feed.html boards 13 and 14). It opens by itself over any page when the first
 * application in line is waiting for answers or an emailed code, and it cannot be dismissed: it closes when the
 * answer is saved or the application stops waiting.
 */
export function NeedsInputDialog() {
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const { waiting: summary, refresh } = useApplicationsSummary();
  const first = summary?.[0] ?? null;
  const total = summary?.length ?? 0;
  const others = Math.max(total - 1, 0);

  // Load the questions only when a different application, or a new prompt on the same one, comes first in line.
  useEffect(() => {
    if (!first) return;
    let stopped = false;
    void (async () => {
      const response = await fetch(`/api/applications/${first.id}`, { cache: "no-store" });
      if (!response.ok || stopped) return;
      const detail = (await response.json()) as { company: string; title: string; pendingQuestions: PendingQuestion[] };
      if (!stopped) setWaiting({ id: first.id, company: detail.company, title: detail.title, questions: detail.pendingQuestions });
    })();
    return () => {
      stopped = true;
    };
    // first?.promptId: a rejected code or a second question is a new prompt for the same application.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first?.id, first?.promptId]);

  // Shown only while the loaded questions belong to the application first in line.
  const current = waiting && first && waiting.id === first.id ? waiting : null;
  const isCode = Boolean(current?.questions.some((question) => question.key === CODE_KEY));

  function setValue(key: string, value: string) {
    setValues((existing) => ({ ...existing, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!current) return;
    const missing = current.questions.filter((question) => !values[question.key]?.trim());
    if (missing.length > 0) {
      // A long list scrolls; take the user to the first one left (15 Oct: answers were never saved, "Answer every
      // question." sat below the fold).
      setError(missing.length === 1 ? "Answer this question to save." : `Answer the ${missing.length} questions left to save.`);
      document.getElementById(`question-${missing[0].key}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    setSaving(true);
    setError("");
    const response = await fetch(`/api/applications/${current.id}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: current.questions.map((question) => ({
          key: question.key,
          question: question.label,
          answer: values[question.key].trim(),
        })),
      }),
    });
    setSaving(false);
    if (!response.ok) {
      if (response.status === 409) {
        // Cancelled, or another tab already answered it: nothing to save any more.
        setError("This application is no longer waiting for an answer.");
        refresh();
      } else if (response.status === 400) {
        setError("One of these answers could not be saved. Check that each is filled in and not unusually long.");
      } else {
        setError("Could not save that answer. Try again in a moment.");
      }
      return;
    }
    setWaiting(null);
    setValues({});
    refresh();
    void forgetVisitedPages();
  }

  async function pasteCode() {
    try {
      const text = await navigator.clipboard.readText();
      setValue(CODE_KEY, text.replace(/\s+/g, "").slice(0, CODE_LENGTH));
    } catch {
      setError("Could not read the clipboard. Type the code instead.");
    }
  }

  const open = Boolean(current && current.questions.length > 0);
  const single = current?.questions.length === 1;

  return (
    <Sheet open={open}>
      <SheetContent aria-label="The agent needs you">
        {current ? (
          <form onSubmit={onSubmit} className="flex flex-col">
            <div className="mt-3 flex h-11 items-center">
              <AccentPill>
                Needs you · 1 of {Math.max(total, 1)}
              </AccentPill>
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <CompanyMark name={current.company} size={44} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <SheetTitle className="m-0 text-[15px] font-semibold">
                  <span className="sr-only">{current.company} asks. </span>
                  <span aria-hidden="true">
                    {current.company} · {current.title}
                  </span>
                </SheetTitle>
                <SheetDescription className="m-0 text-[13px] text-muted-foreground">
                  <span className="sr-only">{current.title}. </span>
                  {isCode ? "Their job board emailed you a code" : "Your answer is saved and the application continues."}
                  {others > 0 ? ` ${others} more waiting after this.` : ""}
                </SheetDescription>
              </div>
            </div>

            {current.questions.map((question) => {
              const id = `answer-${question.key}`;
              const value = values[question.key] ?? "";
              if (question.key === CODE_KEY) {
                return (
                  <div key={question.key} className="flex flex-col">
                    <label htmlFor={id} className="mt-[22px] type-title">
                      Enter the {CODE_LENGTH}-character code
                    </label>
                    <p className="m-0 mt-1.5 text-sm text-muted-foreground">{question.label}</p>
                    <div className="mt-[18px]">
                      <OtpInput id={id} label={`${CODE_LENGTH}-character code`} length={CODE_LENGTH} value={value} onChange={(next) => setValue(question.key, next)} />
                    </div>
                    <span className="mt-2.5 min-h-5 text-sm text-muted-foreground">
                      {value.length >= CODE_LENGTH ? "Ready. Save and we carry on." : "We'll paste it into their form and carry on."}
                    </span>
                    <Button type="button" variant="strong" size="lg" className="mt-2.5 w-full" onClick={() => void pasteCode()}>
                      Paste code
                    </Button>
                  </div>
                );
              }
              const options = question.options ?? [];
              // "Select all that apply": several choices, kept one per line in the answer (lib/choices.ts).
              const multi = question.type === "checkbox-group" && options.length > 0;
              const chosen = multi ? splitChoices(value) : [];
              const toggle = (option: string) =>
                setValue(question.key, joinChoices(options.filter((item) => (item === option ? !chosen.includes(item) : chosen.includes(item)))));
              return (
                <div key={question.key} id={`question-${question.key}`} className="flex flex-col">
                  <label htmlFor={multi || (options.length > 0 && options.length <= MAX_ANSWER_BUTTONS) ? undefined : id} className={single ? "mt-[22px] type-title" : "mt-[18px] type-lead font-semibold"}>
                    {question.label}
                  </label>
                  {multi ? (
                    <>
                      <span className="mt-1.5 text-sm text-muted-foreground">Choose all that apply.</span>
                      <div id={id} role="group" aria-label={question.label} className="mt-4 grid gap-2.5">
                        {options.map((option) => (
                          <Chip key={option} shape="answer" selected={chosen.includes(option)} onClick={() => toggle(option)}>
                            {option}
                          </Chip>
                        ))}
                      </div>
                    </>
                  ) : options.length > 0 && options.length <= MAX_ANSWER_BUTTONS ? (
                    <div id={id} role="group" aria-label={question.label} className={options.length === 2 ? "mt-5 grid grid-cols-2 gap-2.5" : "mt-5 grid gap-2.5"}>
                      {options.map((option) => (
                        <Chip key={option} shape="answer" selected={value === option} onClick={() => setValue(question.key, option)}>
                          {option}
                        </Chip>
                      ))}
                    </div>
                  ) : options.length > 0 ? (
                    <NativeSelect id={id} className="mt-4 w-full" value={value} onChange={(event) => setValue(question.key, event.target.value)}>
                      <option value="">Select</option>
                      {options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : question.type === "textarea" ? (
                    <TextAreaBox id={id} className="mt-4" value={value} onChange={(event) => setValue(question.key, event.target.value)} />
                  ) : (
                    <InputBox id={id} boxClassName="mt-4" value={value} onChange={(event) => setValue(question.key, event.target.value)} />
                  )}
                </div>
              );
            })}

            {/* Pinned to the bottom of the sheet: with many questions, Save and its message stay in view. */}
            <div className="sticky bottom-[-30px] -mx-5 mt-5 -mb-[30px] border-t border-line bg-surface px-5 pt-3.5 pb-[30px]">
              {error ? <FieldError className="mb-3">{error}</FieldError> : null}
              <Button type="submit" variant="primary" size="xl" className="w-full" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <InfoNote size="sm" className="mt-3.5">
                {isCode ? "The code goes only into this application's form." : "The agent never answers questions like this without you."}
              </InfoNote>
            </div>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
