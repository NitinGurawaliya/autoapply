import { AgentStatus } from "@/components/patterns/agent-status";
import { Skeleton } from "@/components/ui/eyebrow";

export default function FeedLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 px-5 pb-2" aria-busy="true" aria-label="Loading jobs">
      <div className="flex h-11 items-center gap-2.5">
        <Skeleton className="size-11 rounded-full" />
        <div className="flex-1" />
        <Skeleton className="h-9 w-24 rounded-full" />
        <Skeleton className="size-11 rounded-full" />
      </div>
      <AgentStatus text="Your agent is finding jobs for you" className="mt-[18px] justify-center" />
      <Skeleton className="h-[420px] rounded-card" />
    </div>
  );
}
