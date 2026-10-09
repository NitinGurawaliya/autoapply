import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AccountActions } from "./account-actions";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account and data</h1>
        <p className="mt-1 text-sm text-muted-foreground">Signed in as {user.email}. Your data is yours: take a copy or remove it.</p>
      </div>
      <AccountActions />
    </>
  );
}
