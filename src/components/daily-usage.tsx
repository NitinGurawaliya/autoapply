import { dailyUsage, loadRules } from "@/modules/governance";
import { UsagePill } from "@/components/patterns/top-bar";

/** Applications started today against the daily cap, as the design's "18/100" pill. */
export async function DailyUsage({ userId }: { userId: string }) {
  const used = await dailyUsage(userId);
  return <UsagePill used={used} cap={loadRules().max_applications_per_day} />;
}
