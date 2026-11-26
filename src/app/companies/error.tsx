"use client";

import { Screen } from "@/components/patterns/layout";
import { PageError } from "@/components/patterns/states";

export default function CompaniesError({ reset }: { reset: () => void }) {
  return (
    <Screen>
      <PageError title="Could not load this page" reset={reset} />
    </Screen>
  );
}
