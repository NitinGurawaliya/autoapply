import { Skeleton } from "@/components/ui/eyebrow";

/**
 * The moment before the feed page's first reads land: only the top bar. The body's own wait follows at once (the card
 * skeleton, or the agent reading while today's set is built), so a card skeleton here would show and then be swapped
 * for the reading scene (21 Nov: "the skeleton comes, then the animation for a second").
 */
export default function FeedLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 px-5 pb-2" aria-busy="true" aria-label="Loading jobs">
      <div className="flex h-11 items-center gap-2.5">
        <Skeleton className="size-11 rounded-full" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-24 rounded-control" />
        <Skeleton className="size-11 rounded-control" />
      </div>
    </div>
  );
}
