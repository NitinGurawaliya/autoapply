import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { TitleTopBar } from "@/components/patterns/top-bar";
import { AccountActions } from "./account-actions";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return (
    <>
      <TitleTopBar title="Account and data" sub={`Signed in as ${user.email}. Your data is yours: take a copy or remove it.`} />
      <AccountActions />
    </>
  );
}
