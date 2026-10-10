"use client";

import type { ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icons";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type Opener = "icon" | "edit" | "widen";

/**
 * The filter chips are server-rendered links (choosing one reloads the feed); this is only the bottom sheet they
 * open in (design/feed.html "Filters"). It opens from the top bar, or from the empty states' buttons.
 */
export function FilterSheet({
  activeCount = 0,
  opener = "icon",
  resetHref,
  children,
}: {
  activeCount?: number;
  opener?: Opener;
  resetHref: string;
  children: ReactNode;
}) {
  return (
    <Sheet>
      {opener === "icon" ? (
        <SheetTrigger
          render={<IconButton variant="line" aria-label={activeCount > 0 ? `Filters, ${activeCount} on` : "Filters"} className="relative" />}
        >
          <Icon name="filters" size={20} />
          {activeCount > 0 ? (
            <span className="absolute -top-1 -right-1 box-border flex h-5 min-w-5 items-center justify-center rounded-full border-[1.5px] border-primary-edge bg-primary px-[5px] text-[11px] font-bold text-ink">
              {activeCount}
            </span>
          ) : null}
        </SheetTrigger>
      ) : (
        <SheetTrigger render={<Button variant="line" size="lg" className="w-full" />}>
          {opener === "edit" ? "Edit filters" : "Widen my filters"}
        </SheetTrigger>
      )}
      <SheetContent aria-label="Filters">
        <div className="mt-2.5 flex h-11 items-center justify-between">
          <SheetTitle className="m-0 type-display-sm">Filters</SheetTitle>
          <a href={resetHref} className={buttonVariants({ variant: "underline", size: "text" })}>
            Reset
          </a>
        </div>
        <SheetDescription className="sr-only">Pick what you want to see. The page reloads with your choice.</SheetDescription>
        {children}
        <SheetClose render={<Button variant="primary" size="xl" className="mt-[26px] w-full" />}>Show jobs</SheetClose>
      </SheetContent>
    </Sheet>
  );
}

