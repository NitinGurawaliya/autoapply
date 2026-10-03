import { getCurrentUser } from "@/lib/auth";
import { NeedsInputDialog } from "@/components/needs-input-dialog";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const { id } = await params;
  const application = await db.application.findFirst({
    where: { id, userId: user.id },
    select: { id: true, status: true, error: true },
  });

  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Application</h1>
        {application ? (
          <p className="mt-2 text-sm text-muted-foreground">Status {application.status}</p>
        ) : (
          <p className="mt-2 rounded-lg border border-border px-3 py-6 text-sm text-muted-foreground">
            This application was not found.
          </p>
        )}
        {application?.error ? <p className="mt-2 text-sm text-destructive">{application.error}</p> : null}
      </div>
      <NeedsInputDialog />
    </main>
  );
}
