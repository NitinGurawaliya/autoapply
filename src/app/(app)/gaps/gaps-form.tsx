"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Gap = { key: string; label: string; type: string; options: string[] | null; jobs: number };

/** One row per missing fact; saving it stores the answer and triggers a rescan of the feed. */
export function GapsForm({ gaps }: { gaps: Gap[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  async function save(gap: Gap) {
    const answer = values[gap.key]?.trim();
    if (!answer) {
      setError((current) => ({ ...current, [gap.key]: "Enter an answer first." }));
      return;
    }
    setSaving(gap.key);
    setError((current) => ({ ...current, [gap.key]: "" }));
    const response = await fetch("/api/gaps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: gap.key, answer }),
    });
    setSaving(null);
    if (!response.ok) {
      setError((current) => ({ ...current, [gap.key]: "Could not save that answer. Try again." }));
      return;
    }
    setSaved((current) => ({ ...current, [gap.key]: true }));
    router.refresh();
  }

  return (
    <ul className="flex flex-col gap-3">
      {gaps.map((gap) => (
        <li key={gap.key} className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <p className="text-sm font-medium">{gap.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Asked by {gap.jobs} {gap.jobs === 1 ? "job" : "jobs"} in your feed
          </p>
          {saved[gap.key] ? (
            <p className="mt-3 text-sm text-success">Saved. We will use it from now on.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {gap.options && gap.options.length > 0 ? (
                <select
                  aria-label={gap.label}
                  value={values[gap.key] ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, [gap.key]: event.target.value }))}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                >
                  <option value="">Select</option>
                  {gap.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <Input aria-label={gap.label} value={values[gap.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [gap.key]: event.target.value }))} />
              )}
              {error[gap.key] ? <p className="text-sm text-destructive">{error[gap.key]}</p> : null}
              <Button type="button" size="sm" className="self-start" disabled={saving === gap.key} onClick={() => void save(gap)}>
                {saving === gap.key ? "Saving…" : "Save"}
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
