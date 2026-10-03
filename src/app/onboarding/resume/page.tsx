import { getCurrentUser } from "@/lib/auth";
import { SignOutForm } from "@/components/sign-out-form";
import { redirect } from "next/navigation";
import { ResumeUploadForm } from "./upload-form";

export default async function ResumePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload resume</h1>
        <p className="mt-2 text-sm text-muted-foreground">PDF only. We extract what is written on it.</p>
      </div>
      <ResumeUploadForm />
      <SignOutForm />
    </main>
  );
}
