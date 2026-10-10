"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/content";
import { DeckEmptyArt } from "@/components/patterns/drawings";

export default function FeedError({ reset }: { reset: () => void }) {
  return (
    <EmptyState
      art={<DeckEmptyArt />}
      title="Could not load the feed"
      text="Something went wrong on our side. Your swipes so far are saved."
      actions={
        <Button variant="primary" size="xl" className="w-full" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
