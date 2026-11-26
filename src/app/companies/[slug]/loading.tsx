import { Screen } from "@/components/patterns/layout";
import { ShareTopBar } from "@/app/j/[slug]/share-sections";
import { Skeleton } from "@/components/ui/eyebrow";

// design/companies.html 8: the company page's shape in grey; the index and letter pages use the same rows.
export default function CompaniesLoading() {
  return (
    <Screen className="px-5">
      <ShareTopBar right={null} />
      <div className="mt-2 flex items-center gap-3.5">
        <Skeleton className="size-14 rounded-control" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-6 w-3/5" />
          <Skeleton className="h-3.5 w-2/5" />
        </div>
      </div>
      <Skeleton className="mt-5 h-5 w-[30%]" />
      <Skeleton className="mt-2 h-3.5 w-1/2" />
      <Skeleton className="mt-8 h-5 w-1/4" />
      <div className="mt-3 flex flex-col gap-px overflow-hidden rounded-card bg-surface p-3.5 shadow-lift">
        {[70, 55, 64].map((width) => (
          <div key={width} className="flex flex-col gap-2 py-3">
            <Skeleton className="h-4" style={{ width: `${width}%` }} />
            <Skeleton className="h-3" style={{ width: "40%" }} />
          </div>
        ))}
      </div>
    </Screen>
  );
}
