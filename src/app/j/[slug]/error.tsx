"use client";

import { Screen } from "@/components/patterns/layout";
import { PageError } from "@/components/patterns/states";

export default function ShareError({ reset }: { reset: () => void }) {
  return (
    <Screen>
      <PageError title="Could not load this job" reset={reset} />
    </Screen>
  );
}
