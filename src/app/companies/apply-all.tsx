"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { ApplyAllState } from "./actions";

// "Apply to all that fit" on a company page (Phase X, X5): a confirm sheet listing the matching jobs best first, then
// what was sent and what waits under a cap, in words.
export function ApplyAll({
  company,
  jobs,
  perWeek,
  action,
}: {
  company: string;
  jobs: Array<{ id: string; title: string; score: number | null }>;
  perWeek: number;
  action: (previous: ApplyAllState, form: FormData) => Promise<ApplyAllState>;
}) {
  const [state, submit, pending] = useActionState(action, null);
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="primary" size="lg" className="mt-3 w-full rounded-full lg:w-auto" />}>
        Apply to all {jobs.length} that fit
        <Icon name="arrowRight" size={16} />
      </SheetTrigger>
      <SheetContent aria-label="Apply to all that fit">
        <SheetTitle className="m-0 mt-2.5 type-heading">Apply to all that fit</SheetTitle>
        {state ? (
          <>
            <SheetDescription className="m-0 mt-3 type-body text-foreground">{state.message}</SheetDescription>
            <div className="mt-6 flex flex-col gap-2.5">
              {state.sent > 0 ? (
                <Link href="/applications" className="flex h-12 items-center justify-center rounded-control bg-primary type-body font-semibold text-primary-foreground">
                  Follow them in Applications
                </Link>
              ) : null}
              <SheetClose render={<Button variant="line" size="lg" className="w-full" />}>Done</SheetClose>
            </div>
          </>
        ) : (
          <form action={submit}>
            <SheetDescription className="m-0 mt-2 type-body text-muted-foreground">
              Your agent applies to these at {company}, best match first. It sends at most {perWeek} a week to one company; any more wait until next week.
            </SheetDescription>
            <ol className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
              {jobs.map((job, index) => (
                <li key={job.id} className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
                  <span className="min-w-0 type-body">
                    <span className="mr-2 font-mono text-muted-foreground tabular-nums">{index + 1}</span>
                    {job.title}
                  </span>
                  {job.score != null ? <span className="flex-none type-meta text-brand-text tabular-nums">{job.score}</span> : null}
                </li>
              ))}
            </ol>
            <Button type="submit" variant="primary" size="xl" className="mt-6 w-full" disabled={pending} aria-busy={pending}>
              {pending ? "Sending to your agent…" : `Apply to ${jobs.length}`}
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
