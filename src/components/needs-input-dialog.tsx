"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApplicationsSummary } from "@/components/applications-summary";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

export function NeedsInputDialog() {
  const router = useRouter();
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const { waiting: summary, refresh } = useApplicationsSummary();
  const first = summary?.[0] ?? null;
  const others = summary ? Math.max(summary.length - 1, 0) : 0;

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

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!current) return;
    if (current.questions.some((question) => !values[question.key]?.trim())) {
      setError("Answer every question.");
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
      setError("Could not save that answer.");
      return;
    }
    setWaiting(null);
    setValues({});
    refresh();
    router.refresh();
  }

  const open = Boolean(current && current.questions.length > 0);

  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{current ? `${current.company} asks` : "This job asks"}</DialogTitle>
          <DialogDescription>
            {current ? `${current.title}. ` : ""}Your answer is saved and the application continues.
            {current && others > 0 ? ` ${others} more waiting after this.` : ""}
          </DialogDescription>
        </DialogHeader>
        {current ? (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {current.questions.map((question) => (
              <div key={question.key} className="flex flex-col gap-2">
                <Label htmlFor={`answer-${question.key}`}>{question.label}</Label>
                {question.options && question.options.length > 0 ? (
                  <select
                    id={`answer-${question.key}`}
                    value={values[question.key] ?? ""}
                    onChange={(event) => setValues((current) => ({ ...current, [question.key]: event.target.value }))}
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  >
                    <option value="">Select</option>
                    {question.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={`answer-${question.key}`}
                    value={values[question.key] ?? ""}
                    onChange={(event) => setValues((current) => ({ ...current, [question.key]: event.target.value }))}
                  />
                )}
              </div>
            ))}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
