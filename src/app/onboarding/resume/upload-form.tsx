"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResumeUploadForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("resume");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a PDF resume.");
      return;
    }
    setPending(true);
    setError("");
    const body = new FormData();
    body.set("resume", file);
    const response = await fetch("/api/profile/resume", { method: "POST", body });
    if (!response.ok) {
      setPending(false);
      setError("Could not read that PDF. Try another file.");
      return;
    }
    router.push("/onboarding/confirm");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="resume">Resume PDF</Label>
        <Input id="resume" name="resume" type="file" accept="application/pdf,.pdf" required />
      </div>
      {error ? (
        <p className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Reading resume…" : "Upload"}
      </Button>
    </form>
  );
}
