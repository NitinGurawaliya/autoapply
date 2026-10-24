import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dailySent, dailyUsage, loadRules } from "@/modules/governance";
import { TitleTopBar } from "@/components/patterns/top-bar";
import { ApplicationsList } from "./applications-list";

export default async function ApplicationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const [used, sent, working] = await Promise.all([
    dailyUsage(user.id),
    dailySent(user.id),
    db.application.count({ where: { userId: user.id, status: { in: ["queued", "inspecting", "filling"] } } }),
  ]);
  const cap = loadRules().max_applications_per_day;
  // "19 sent today · Your agent is working on 3"; how many are left only as the daily limit comes near (24 Oct, owner).
  const sub = [`${sent} sent today`, used >= cap ? "Done for today" : cap - used <= 5 ? `${cap - used} left` : null, working > 0 ? `Your agent is working on ${working}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <TitleTopBar title="Applications" sub={sub} />
      <ApplicationsList />
    </>
  );
}
