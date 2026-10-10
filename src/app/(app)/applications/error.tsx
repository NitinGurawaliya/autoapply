"use client";

import { PageError } from "@/components/patterns/states";

export default function ApplicationsError({ reset }: { reset: () => void }) {
  return <PageError title="Could not load your applications" reset={reset} />;
}
