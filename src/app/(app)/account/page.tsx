import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { TitleTopBar } from "@/components/patterns/top-bar";
import { currentBrief } from "@/modules/profile";
import { AccountActions } from "./account-actions";
import { BriefSection } from "./brief-section";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const profile = await db.profile.findUnique({ where: { userId: user.id }, select: { resumeKey: true, avoid: true } });
  // The brief is rebuilt from the profile on the way (a write only when it changed); a failure shows in its own card.
  const brief = profile ? await currentBrief(user.id).then((result) => ({ brief: result?.brief ?? null, learned: result?.learned ?? [], failed: false }), () => ({ brief: null, learned: [], failed: true }))
    : { brief: null, learned: [], failed: false };
  return (
    <>
      <TitleTopBar title="Account and data" sub={`Signed in as ${user.email}. Your data is yours: take a copy or remove it.`} />
      <AccountActions hasResume={Boolean(profile?.resumeKey)}>
        <BriefSection brief={brief.brief} avoid={profile?.avoid ?? []} learned={brief.learned} failed={brief.failed} />
      </AccountActions>
    </>
  );
}
