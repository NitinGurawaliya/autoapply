"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/eyebrow";
import { EmptyState } from "@/components/patterns/content";
import { DeckEmptyArt } from "@/components/patterns/drawings";

/** Loading for a page with a title bar and rows. */
export function PageLoading({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div className="flex flex-col gap-3 px-5" aria-busy="true" aria-label={label}>
      <div className="flex h-11 items-center gap-3">
        <Skeleton className="h-9 flex-1 rounded-tile" />
        <Skeleton className="size-11 rounded-full" />
      </div>
      <Skeleton className="h-4 w-2/3 rounded-full" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="mt-2 h-24 rounded-[18px]" />
      ))}
    </div>
  );
}

/** A page that failed to load, with a way to try again. */
export function PageError({ title, reset }: { title: string; reset: () => void }) {
  return (
    <EmptyState
      art={<DeckEmptyArt />}
      title={title}
      text="Something went wrong on our side. Nothing you did was lost."
      actions={
        <Button variant="primary" size="xl" className="w-full" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
