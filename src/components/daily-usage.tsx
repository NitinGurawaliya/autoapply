import { dailySent, dailyUsage, loadRules } from "@/modules/governance";
import { UsagePill } from "@/components/patterns/top-bar";

/** Today's sent applications, and near the cap what is left of it (the daily-cap rule counts every started one). */
export async function DailyUsage({ userId }: { userId: string }) {
  const [sent, used] = await Promise.all([dailySent(userId), dailyUsage(userId)]);
  return <UsagePill sent={sent} used={used} cap={loadRules().max_applications_per_day} />;
}
