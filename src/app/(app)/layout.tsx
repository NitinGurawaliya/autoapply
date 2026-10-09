import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { NavTabs } from "@/components/nav-tabs";
import { NeedsInputDialog } from "@/components/needs-input-dialog";
import { NeedsInputNotifier } from "@/components/needs-input-notifier";
import { SignOutForm } from "@/components/sign-out-form";
import { UserMenu } from "@/components/user-menu";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

// One shell for every signed-in page: header, navigation, account menu, and the input popup.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const pending = await db.application.count({ where: { userId: user.id, status: "needs_input" } });

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[480px] items-center justify-between gap-3 px-4">
          <Link href="/feed" aria-label="SwipeApply home">
            <Logo />
          </Link>
          <NavTabs variant="top" initialPending={pending} />
          <div className="flex items-center gap-1">
            <NeedsInputNotifier />
            <UserMenu name={user.name} email={user.email}>
              <Link href="/account" className="mb-2 block rounded-lg px-1 py-1.5 text-sm hover:bg-accent/50">
                Account and data
              </Link>
              <SignOutForm />
            </UserMenu>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-6 px-4 pb-28 pt-6 md:pb-12">{children}</main>
      <NavTabs variant="bottom" initialPending={pending} />
      <NeedsInputDialog />
    </div>
  );
}
