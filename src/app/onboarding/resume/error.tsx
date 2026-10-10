"use client";

import { Screen } from "@/components/patterns/layout";
import { PageError } from "@/components/patterns/states";

export default function OnboardingError({ reset }: { reset: () => void }) {
  return (
    <Screen>
      <PageError title="Could not open the upload page" reset={reset} />
    </Screen>
  );
}
