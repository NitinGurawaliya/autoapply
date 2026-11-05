import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { TitleTopBar } from "@/components/patterns/top-bar";
import { sourcesOverview } from "@/modules/sources";
import { AccountActions } from "./account-actions";
import { ConnectedSites } from "./connected-sites";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const [profile, sources] = await Promise.all([db.profile.findUnique({ where: { userId: user.id }, select: { resumeKey: true } }), sourcesOverview(user.id)]);
  return (
    <>
      <TitleTopBar title="Account and data" sub={`Signed in as ${user.email}. Your data is yours: take a copy or remove it.`} />
      <div className="px-5 pt-4">
        <ConnectedSites initial={sources} />
      </div>
      <AccountActions hasResume={Boolean(profile?.resumeKey)} />
    </>
  );
}
