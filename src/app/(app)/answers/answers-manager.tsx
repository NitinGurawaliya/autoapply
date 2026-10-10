"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { FieldLabel, InputBox, NativeSelect } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { SourceBadge } from "@/components/ui/source-badge";
import { EmptyState } from "@/components/patterns/content";
import { DeckEmptyArt } from "@/components/patterns/drawings";
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
    <div className="flex flex-col gap-[22px] px-5 pt-4 pb-6">
      {groups.length === 0 ? (
        <EmptyState
          art={<DeckEmptyArt />}
          title="Nothing saved yet"
          text="Answers you give in onboarding or when an application asks will show up here."
          headingLevel="h2"
          className="py-6"
        />
      ) : (
        groups.map((group) => (
          <section key={group.name} className="flex flex-col gap-2.5" aria-label={group.name}>
            <Eyebrow as="h2">{group.name}</Eyebrow>
            <ul className="m-0 flex list-none flex-col rounded-panel border-[1.5px] border-line bg-surface px-4 py-1">
              {group.rows.map((row, index) => (
                <li key={row.key} className={index > 0 ? "flex flex-col gap-2 border-t border-line py-3" : "flex flex-col gap-2 py-3"} data-answer-key={row.key}>
                  <div className="flex items-start justify-between gap-2.5">
                    <span className="text-[13px] text-muted-foreground">{titleOf(row)}</span>
                    <SourceBadge source={row.source} />
                  </div>
                  {editing === row.key ? (
                    <form
                      className="flex flex-col gap-2.5"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (draft.trim() && (await save(row, draft.trim()))) setEditing(null);
                      }}
                    >
                      <InputBox tone="soft" value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`New value for ${titleOf(row)}`} maxLength={2000} autoFocus />
                      <div className="flex items-center gap-4">
                        <Button type="submit" variant="primary" size="row" className="shadow-none" disabled={busy || !draft.trim()}>
                          Save
                        </Button>
                        <Button type="button" variant="quiet" size="text" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="m-0 text-base font-semibold break-words whitespace-pre-wrap">{row.answer}</p>
                      {SENSITIVE_KEYS.has(row.key) ? (
                        <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                          <Icon name="lock" size={14} className="flex-none" />
                          Sensitive: only ever filled from what you typed, never written by AI.
                        </span>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-4">
                        {confirming === row.key ? (
                          <>
                            <Button type="button" variant="strong" size="row" disabled={busy} onClick={() => void remove(row)}>
                              Yes, delete
                            </Button>
                            <Button type="button" variant="quiet" size="text" onClick={() => setConfirming(null)}>
                              Keep it
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="underline"
                              size="text"
                              className="h-9 text-sm"
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
                              variant="quiet"
                              size="text"
                              className="h-9 text-sm"
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

      <section className="flex flex-col gap-3" aria-label="Add an answer">
        {adding ? (
          <form
            className="box-border flex flex-col gap-3.5 rounded-panel border-2 border-edge bg-surface p-4 shadow-hard"
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <span className="text-base font-semibold">Add an answer</span>
            <div className="flex flex-col gap-2">
              <FieldLabel tone="muted" htmlFor="add-key">
                Which answer
              </FieldLabel>
              <NativeSelect id="add-key" value={newKey} onChange={(event) => setNewKey(event.target.value)}>
                {ADDABLE_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {ANSWER_LABELS[key]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <FieldLabel tone="muted" htmlFor="add-value">
                Your answer
              </FieldLabel>
              <InputBox id="add-value" tone="soft" value={newValue} onChange={(event) => setNewValue(event.target.value)} maxLength={2000} />
            </div>
            <div className="flex items-center gap-4">
              <Button type="submit" variant="primary" size="row" className="shadow-none" disabled={busy || !newValue.trim()}>
                Save answer
              </Button>
              <Button type="button" variant="quiet" size="text" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="line" size="lg" className="w-full" onClick={() => setAdding(true)}>
            Add an answer
          </Button>
        )}
      </section>
    </div>
  );
}
