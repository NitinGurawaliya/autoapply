import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { NotificationsToggle } from "@/components/notifications";

/**
 * On the application page when it was opened from a share link (Phase U5, design/share.html 11): what comes next for
 * someone who arrived from LinkedIn or X. The notifications switch (to hear when it is sent), then today's other picks,
 * the one primary action, which opens the feed and its reveal.
 */
export function ArrivalCard({ picksLeft, stopped }: { picksLeft: number | null; stopped: boolean }) {
  return (
    <section aria-label="What's next" className="mt-5 flex flex-col rounded-card bg-surface p-4 shadow-lift">
      {/* An application that didn't go through has nothing to hear about: only the other picks. */}
      {stopped ? null : (
        <>
          <p className="m-0 type-section">Your agent has it from here</p>
          <p className="m-0 mt-1 type-body text-pretty text-muted-foreground">Turn on notifications to hear when it&apos;s sent, or if your agent needs an answer.</p>
          <div className="mt-3 -mx-2">
            <NotificationsToggle />
          </div>
        </>
      )}
      <div className={stopped ? undefined : "mt-3 border-t border-line pt-3.5"}>
        <p className="m-0 type-body">{picksLeft ? `${picksLeft} more picked for you today` : "More jobs picked for you today"}</p>
        <Link href="/feed" className={buttonVariants({ variant: "primary", size: "xl", className: "mt-3 w-full" })}>
          See today&apos;s jobs
        </Link>
      </div>
    </section>
  );
}
