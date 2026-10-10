import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dailyUsage, loadRules } from "@/modules/governance";
import { TitleTopBar } from "@/components/patterns/top-bar";
import { ApplicationsList } from "./applications-list";

export default async function ApplicationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const [used, working] = await Promise.all([
    dailyUsage(user.id),
    db.application.count({ where: { userId: user.id, status: { in: ["queued", "inspecting", "filling"] } } }),
  ]);
  const cap = loadRules().max_applications_per_day;
  // "19 sent today · 81 left · Your agent is working on 3" (design/applications.html).
  const sub = [`${used} sent today`, used >= cap ? "Daily limit reached" : `${cap - used} left`, working > 0 ? `Your agent is working on ${working}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <TitleTopBar title="Applications" sub={sub} />
      <ApplicationsList />
    </>
  );
}
