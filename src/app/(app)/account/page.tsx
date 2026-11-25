import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { TitleTopBar } from "@/components/patterns/top-bar";
import { currentBrief } from "@/modules/profile";
import { accountRows, employerAccountsPermission, hasApplicationPassword } from "@/modules/accounts";
import { sourcesOverview } from "@/modules/sources";
import { AccountActions } from "./account-actions";
import { BriefSection } from "./brief-section";
import { ConnectedSites } from "./connected-sites";
import { EmployerAccounts } from "./employer-accounts";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const [profile, sources] = await Promise.all([db.profile.findUnique({ where: { userId: user.id }, select: { resumeKey: true, avoid: true } }), sourcesOverview(user.id)]);
  // The brief is rebuilt from the profile on the way (a write only when it changed); a failure shows in its own card.
  const brief = profile ? await currentBrief(user.id).then((result) => ({ brief: result?.brief ?? null, learned: result?.learned ?? [], failed: false }), () => ({ brief: null, learned: [], failed: true }))
    : { brief: null, learned: [], failed: false };
  // Phase V: the employer accounts the agent made, and whether their password exists yet (never the password itself here).
  const [rows, password, allowed] = await Promise.all([accountRows(user.id), hasApplicationPassword(user.id), employerAccountsPermission(user.id)]);
  return (
    <>
      <TitleTopBar title="Account and data" sub={`Signed in as ${user.email}. Your data is yours: take a copy or remove it.`} />
      <div className="px-5 pt-4">
        <ConnectedSites initial={sources} />
      </div>
      <AccountActions hasResume={Boolean(profile?.resumeKey)}>
        <BriefSection brief={brief.brief} avoid={profile?.avoid ?? []} learned={brief.learned} failed={brief.failed} />
        <EmployerAccounts accounts={rows} passwordSet={password.set} allowed={allowed} />
      </AccountActions>
    </>
  );
}
