"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldError, FieldLabel, InputBox } from "@/components/ui/field";

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
    <div className="flex flex-col gap-5 px-5 pt-4 pb-6">
      {/* The only way back to the upload once onboarding is done (16 Oct QA: a missing resume had no place to fix it). */}
      <section className="box-border flex flex-col gap-2.5 rounded-panel border-[1.5px] border-line bg-surface p-4">
        <h2 className="m-0 text-lg font-semibold tracking-[-0.01em]">Your resume</h2>
        <p className="m-0 text-sm leading-normal text-muted-foreground">Upload a new resume. We read it again and you check what we found before anything changes.</p>
        <a href="/onboarding/resume" className={buttonVariants({ variant: "line", size: "lg", className: "mt-1 w-full" })}>
          Upload a new resume
        </a>
      </section>
      <section className="box-border flex flex-col gap-2.5 rounded-panel border-[1.5px] border-line bg-surface p-4">
        <h2 className="m-0 text-lg font-semibold tracking-[-0.01em]">Download your data</h2>
        <p className="m-0 text-sm leading-normal text-muted-foreground">Your profile, saved answers and every application with what was filled in, as one JSON file.</p>
        <a href="/api/account/export" className={buttonVariants({ variant: "primary", size: "lg", className: "mt-1 w-full" })}>
          Download my data
        </a>
      </section>
      <section className="box-border flex flex-col gap-3 rounded-[22px] border-2 border-edge bg-surface p-[18px] shadow-[0_5px_0_var(--shadow-color)]">
        <h2 className="m-0 text-lg font-semibold tracking-[-0.01em]">Delete your account</h2>
        <p className="m-0 text-sm leading-normal text-muted-foreground">
          This removes your profile, resume, saved answers, applications and screenshots, and stops anything still running. It cannot be undone. Applications already sent to companies stay with those companies.
        </p>
        <div className="flex flex-col gap-2">
          <FieldLabel tone="muted" htmlFor="delete-confirm">
            Type <span className="font-semibold text-foreground">{PHRASE}</span> to confirm
          </FieldLabel>
          <InputBox id="delete-confirm" tone="soft" value={text} onChange={(event) => setText(event.target.value)} autoComplete="off" />
        </div>
        {error ? <FieldError>{error}</FieldError> : null}
        <Button type="button" variant="strong" size="lg" className="w-full" disabled={busy || text.trim() !== PHRASE} onClick={() => void erase()}>
          {busy ? "Deleting..." : "Delete everything"}
        </Button>
      </section>
    </div>
  );
}
