"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icons";

/**
 * What the feed learned from the user's skips (P8): one line each, with × to take it back. Deleting a line restores
 * the rank of that field's jobs, and the next skips count from now, so one more skip never brings it straight back.
 */
export function LearnedLines({ lines }: { lines: Array<{ id: string; note: string }> }) {
  const router = useRouter();
  const [shown, setShown] = useState(lines);
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(id: string) {
    setBusy(id);
    try {
      const response = await fetch(`/api/brief/learned/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error("delete failed");
      setShown((current) => current.filter((line) => line.id !== id));
      router.refresh();
    } catch {
      toast.error("Couldn't remove that", { description: "Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  if (shown.length === 0) return <>Nothing yet</>;
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {shown.map((line) => (
        <li key={line.id} className="-my-1.5 flex items-center justify-between gap-3">
          <span className="min-w-0 truncate" title={line.note}>
            {line.note}
          </span>
          <IconButton aria-label={`Remove "${line.note}"`} disabled={busy === line.id} onClick={() => void remove(line.id)} className="-mr-3">
            <Icon name="close" size={18} />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}
