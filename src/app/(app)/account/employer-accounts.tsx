"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";

export type EmployerAccountRow = { id: string; system: string; employer: string; state: string; createdDays: number };

const SYSTEM: Record<string, string> = { workday: "Workday", darwinbox: "Darwinbox", successfactors: "SuccessFactors" };
const STATE: Record<string, string> = {
  active: "Ready",
  needs_verification: "Verify your email",
  creating: "Being made",
  exists_elsewhere: "You already had one",
  failed: "Couldn't make it",
};
const MASK = "••••••••••••••••";

/**
 * Phase U, U1 (docs/accounts/TDD.md 5): the password your agent uses for employer accounts, and the accounts it made.
 * The password is fetched only when the user asks to see or copy it, and kept on screen only while shown.
 */
export function EmployerAccounts({ accounts, passwordSet }: { accounts: EmployerAccountRow[]; passwordSet: boolean }) {
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function fetchPassword() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/accounts/password", { method: "POST" });
      if (!response.ok) throw new Error(response.status === 429 ? "Too many tries. Try again in a while." : response.status === 503 ? "Employer accounts aren't switched on yet." : "Could not load the password.");
      const body = (await response.json()) as { password: string };
      return body.password;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load the password.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    if (password) {
      setPassword(null);
      return;
    }
    setPassword(await fetchPassword());
  }

  async function copy() {
    const value = password ?? (await fetchPassword());
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy didn't work here. Show it and copy it by hand.");
    }
  }

  return (
    <section className="box-border flex flex-col gap-2.5 rounded-panel border border-line bg-surface p-4">
      <h2 className="m-0 text-lg font-semibold">Employer accounts</h2>
      <p className="m-0 text-sm leading-normal text-muted-foreground">
        Some employers, such as those on Workday, need an account before you can apply. Your agent makes one with your email and the password below, the same for every employer. Use it to sign in and check an application yourself.
      </p>
      <div className="mt-1 flex items-center gap-2 rounded-control border border-line bg-background px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate font-mono text-sm" aria-live="polite">
          {password ?? (passwordSet ? MASK : "Not made yet")}
        </span>
        <Button type="button" variant="quiet" size="text" disabled={busy} onClick={() => void toggle()}>
          {password ? "Hide" : "Show"}
        </Button>
        <Button type="button" variant="quiet" size="text" disabled={busy} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
      {accounts.length === 0 ? (
        <p className="m-0 text-sm leading-normal text-muted-foreground">No employer accounts yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {accounts.map((account) => (
            <li key={account.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="m-0 truncate text-sm font-semibold capitalize">{account.employer}</p>
                <p className="m-0 text-xs text-muted-foreground">
                  {SYSTEM[account.system] ?? account.system} · {account.createdDays <= 0 ? "today" : account.createdDays === 1 ? "1 day ago" : `${account.createdDays} days ago`}
                </p>
              </div>
              <span className={`shrink-0 text-sm ${account.state === "active" ? "text-foreground" : "font-semibold text-foreground"}`}>{STATE[account.state] ?? account.state}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
