import { redirect } from "next/navigation";
import { NeedsInputDialog } from "@/components/needs-input-dialog";
import { NeedsInputNotifier } from "@/components/notifications";
import { SignOutForm } from "@/components/sign-out-form";
import { getCurrentUser } from "@/lib/auth";
import { ApplicationsSummaryProvider } from "@/components/applications-summary";
import { ShellProvider } from "@/components/patterns/shell-context";
import { TabBar } from "@/components/patterns/tab-bar";

// One shell for every signed-in page (design/feed.html, applications.html): each page draws its own top bar
// (Discover, a title, or a back arrow) with the profile menu; the two-tab bar, the notifier and the input popup
// are mounted here once.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  return (
    <ApplicationsSummaryProvider>
      <ShellProvider value={{ name: user.name, email: user.email, signOut: <SignOutForm /> }}>
        <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-1 flex-col bg-background pt-[max(12px,env(safe-area-inset-top))] pb-[calc(82px+max(0px,env(safe-area-inset-bottom)-24px))]">
          {children}
        </main>
        <TabBar />
        <NeedsInputNotifier />
        <NeedsInputDialog />
      </ShellProvider>
    </ApplicationsSummaryProvider>
  );
}
