"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** The share page's one action; held while the Apply action runs (to Google, or to the resume step). */
export function ApplySubmit({ label = "Apply" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="xl" className="w-full" disabled={pending} aria-busy={pending}>
      {pending ? "Opening…" : label}
    </Button>
  );
}
