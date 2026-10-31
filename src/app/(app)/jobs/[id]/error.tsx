"use client";

import { PageError } from "@/components/patterns/states";

export default function JobError({ reset }: { reset: () => void }) {
  return <PageError title="Could not load this job" reset={reset} />;
}
