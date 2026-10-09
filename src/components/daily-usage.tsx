import { dailyUsage, loadRules } from "@/modules/governance";

/** Today's applications against the daily cap, so the limit is visible before it blocks a swipe. */
export async function DailyUsage({ userId }: { userId: string }) {
  const [used, cap] = [await dailyUsage(userId), loadRules().max_applications_per_day];
  const near = used >= cap * 0.8;
  return (
    <p className={near ? "text-xs font-medium text-amber-700" : "text-xs text-muted-foreground"}>
      Applications today: {used} of {cap}
      {used >= cap ? ". Daily limit reached." : ""}
    </p>
  );
}
