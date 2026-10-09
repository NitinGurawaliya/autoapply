"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PHRASE = "DELETE MY ACCOUNT";

export function AccountActions() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function erase() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: text }),
      });
      if (!response.ok) throw new Error(response.status === 429 ? "Too many attempts. Try again later." : "Could not delete the account.");
      router.replace("/sign-in");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not delete the account.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-card">
        <h2 className="text-sm font-semibold">Download your data</h2>
        <p className="text-sm text-muted-foreground">Your profile, saved answers and every application with what was filled in, as one JSON file.</p>
        <a href="/api/account/export" className="self-start rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Download my data
        </a>
      </section>
      <section className="flex flex-col gap-3 rounded-2xl border border-danger/40 bg-card p-4 shadow-card">
        <h2 className="text-sm font-semibold text-danger">Delete your account</h2>
        <p className="text-sm text-muted-foreground">
          This removes your profile, resume, saved answers, applications and screenshots, and stops anything still running. It cannot be undone. Applications already sent to companies stay with those companies.
        </p>
        <label className="flex flex-col gap-1.5 text-sm">
          Type <span className="font-semibold">{PHRASE}</span> to confirm
          <Input value={text} onChange={(event) => setText(event.target.value)} autoComplete="off" />
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="button" variant="destructive" disabled={busy || text.trim() !== PHRASE} onClick={() => void erase()} className="self-start">
          {busy ? "Deleting..." : "Delete everything"}
        </Button>
      </section>
    </div>
  );
}
