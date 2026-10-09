import { redirect } from "next/navigation";
import { DailyUsage } from "@/components/daily-usage";
import { getCurrentUser } from "@/lib/auth";
import { ApplicationsList } from "./applications-list";

export default async function ApplicationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Applications</h1>
        <p className="mt-1 text-sm text-muted-foreground">Everything you have applied to, and what was filled in.</p>
        <div className="mt-2">
          <DailyUsage userId={user.id} />
        </div>
      </div>
      <ApplicationsList />
    </>
  );
}
