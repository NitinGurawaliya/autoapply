"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldError, InputBox, NativeSelect } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";

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
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {gaps.map((gap) => (
        <li key={gap.key} className="box-border flex flex-col gap-3 rounded-panel border-2 border-edge bg-surface p-4 shadow-hard">
          <div className="flex flex-col gap-1">
            <p className="m-0 type-lead font-semibold">{gap.label}</p>
            <p className="m-0 text-[13px] text-muted-foreground">
              Asked by {gap.jobs} {gap.jobs === 1 ? "job" : "jobs"} in your feed
            </p>
          </div>
          {saved[gap.key] ? (
            <p className="m-0 flex items-center gap-2 text-[15px] font-semibold">
              <span aria-hidden="true" className="flex size-[22px] items-center justify-center rounded-full bg-primary text-ink">
                <Icon name="check" size={12} strokeWidth={3.5} />
              </span>
              Saved. We will use it from now on.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {gap.options && gap.options.length > 0 ? (
                <NativeSelect
                  aria-label={gap.label}
                  className="w-full"
                  value={values[gap.key] ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, [gap.key]: event.target.value }))}
                >
                  <option value="">Select</option>
                  {gap.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <InputBox tone="soft" aria-label={gap.label} value={values[gap.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [gap.key]: event.target.value }))} />
              )}
              {error[gap.key] ? <FieldError>{error[gap.key]}</FieldError> : null}
              <Button type="button" variant="primary" size="row" className="w-full shadow-none" disabled={saving === gap.key} onClick={() => void save(gap)}>
                {saving === gap.key ? "Saving…" : "Save"}
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
