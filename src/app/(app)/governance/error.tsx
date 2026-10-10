"use client";

import { PageError } from "@/components/patterns/states";

export default function PageErrorBoundary({ reset }: { reset: () => void }) {
  return <PageError title="Could not load governance" reset={reset} />;
}
