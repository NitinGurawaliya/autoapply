"use client";

import { SlidersHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/** The filter chips are server-rendered links; this only provides the bottom sheet they open in. */
export function FilterSheet({ activeCount, children }: { activeCount: number; children: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium shadow-card outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring">
        <SlidersHorizontal className="size-4" aria-hidden />
        Filters
        {activeCount > 0 ? (
          <span className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground">
            {activeCount}
          </span>
        ) : null}
      </DialogTrigger>
      <DialogContent className="top-auto bottom-0 max-h-[85vh] max-w-[480px] translate-y-0 overflow-y-auto rounded-b-none rounded-t-2xl p-5 sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Filter jobs</DialogTitle>
          <DialogDescription>Pick what you want to see. The page reloads with your choice.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
