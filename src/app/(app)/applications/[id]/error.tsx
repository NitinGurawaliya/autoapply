"use client";

import { PageError } from "@/components/patterns/states";

export default function ApplicationError({ reset }: { reset: () => void }) {
  return <PageError title="Could not load this application" reset={reset} />;
}
