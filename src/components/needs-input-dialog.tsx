"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  questions: PendingQuestion[];
};

export function NeedsInputDialog() {
  const router = useRouter();
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let stopped = false;

    async function poll() {
      const listResponse = await fetch("/api/applications");
      if (!listResponse.ok) return;
      const list = (await listResponse.json()) as {
        applications: Array<{ id: string; status: string }>;
      };
      const hit = list.applications.find((item) => item.status === "needs_input");
      if (!hit) {
        if (!stopped) setWaiting(null);
        return;
      }
      const detailResponse = await fetch(`/api/applications/${hit.id}`);
      if (!detailResponse.ok) return;
      const detail = (await detailResponse.json()) as { pendingQuestions: PendingQuestion[] };
      if (stopped) return;
      setWaiting({ id: hit.id, questions: detail.pendingQuestions });
    }

    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!waiting) return;
    if (waiting.questions.some((question) => !values[question.key]?.trim())) {
      setError("Answer every question.");
      return;
    }
    setSaving(true);
    setError("");
    const response = await fetch(`/api/applications/${waiting.id}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: waiting.questions.map((question) => ({
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
    router.refresh();
  }

  const open = Boolean(waiting && waiting.questions.length > 0);

  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>This job asks</DialogTitle>
          <DialogDescription>Your answer is saved and the application continues.</DialogDescription>
        </DialogHeader>
        {waiting ? (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {waiting.questions.map((question) => (
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
