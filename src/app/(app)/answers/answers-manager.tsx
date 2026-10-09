"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SourceBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADDABLE_KEYS, ANSWER_LABELS, SENSITIVE_KEYS } from "@/lib/answer-labels";
import { groupOf, GROUP_ORDER } from "@/lib/field-groups";

type Row = { key: string; question: string; answer: string; source: string };

function titleOf(row: Row) {
  return ANSWER_LABELS[row.key] ?? (row.question && row.question !== row.key ? row.question : "A question from an application");
}

export function AnswersManager({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState<string>(ADDABLE_KEYS[0]);
  const [newValue, setNewValue] = useState("");

  const groups = useMemo(() => {
    const byGroup = new Map<string, Row[]>();
    for (const row of rows) byGroup.set(groupOf(row.key), [...(byGroup.get(groupOf(row.key)) ?? []), row]);
    return GROUP_ORDER.filter((name) => byGroup.has(name)).map((name) => ({ name, rows: byGroup.get(name) ?? [] }));
  }, [rows]);

  async function save(row: Row, value: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/answers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: [{ key: row.key, question: row.question || row.key, answer: value, source: "user" }] }),
      });
      if (!response.ok) throw new Error("save failed");
      setRows((current) => {
        const exists = current.some((item) => item.key === row.key);
        const next = { ...row, answer: value, source: "user" };
        return exists ? current.map((item) => (item.key === row.key ? next : item)) : [...current, next];
      });
      toast.success("Saved");
      router.refresh();
      return true;
    } catch {
      toast.error("Could not save that answer.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Row) {
    setBusy(true);
    try {
      const response = await fetch(`/api/answers?key=${encodeURIComponent(row.key)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error("delete failed");
      setRows((current) => current.filter((item) => item.key !== row.key));
      setConfirming(null);
      toast.success("Deleted. The next application that needs it will ask you.");
      router.refresh();
    } catch {
      toast.error("Could not delete that answer.");
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const value = newValue.trim();
    if (!value) return;
    const ok = await save({ key: newKey, question: ANSWER_LABELS[newKey] ?? newKey, answer: value, source: "user" }, value);
    if (ok) {
      setAdding(false);
      setNewValue("");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-card">
          <h2 className="text-base font-semibold">Nothing saved yet</h2>
          <p className="mx-auto mt-1 max-w-[32ch] text-sm text-muted-foreground">Answers you give in onboarding or when an application asks will show up here.</p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.name} className="flex flex-col gap-1.5" aria-label={group.name}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.name}</h2>
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-card">
              {group.rows.map((row) => (
                <li key={row.key} className="flex flex-col gap-2 px-3 py-3" data-answer-key={row.key}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm font-medium">{titleOf(row)}</span>
                    <SourceBadge source={row.source} />
                  </div>
                  {SENSITIVE_KEYS.has(row.key) ? (
                    <span className="text-xs text-muted-foreground">Sensitive: only ever filled from what you typed, never written by AI.</span>
                  ) : null}
                  {editing === row.key ? (
                    <form
                      className="flex flex-col gap-2"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (draft.trim() && (await save(row, draft.trim()))) setEditing(null);
                      }}
                    >
                      <Input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`New value for ${titleOf(row)}`} maxLength={2000} autoFocus />
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
                          Save
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap break-words text-sm">{row.answer}</p>
                      <div className="flex flex-wrap gap-2">
                        {confirming === row.key ? (
                          <>
                            <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void remove(row)}>
                              Yes, delete
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(null)}>
                              Keep it
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditing(row.key);
                                setDraft(row.answer);
                                setConfirming(null);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setConfirming(row.key);
                                setEditing(null);
                              }}
                            >
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-card" aria-label="Add an answer">
        {adding ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              Which answer
              <select value={newKey} onChange={(event) => setNewKey(event.target.value)} className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm">
                {ADDABLE_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {ANSWER_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Your answer
              <Input value={newValue} onChange={(event) => setNewValue(event.target.value)} maxLength={2000} />
            </label>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || !newValue.trim()}>
                Save answer
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setAdding(true)}>
            Add an answer
          </Button>
        )}
      </section>
    </div>
  );
}
