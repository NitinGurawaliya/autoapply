import { redirect } from "next/navigation";
import { getCurrentUser, signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/patterns/layout";
import { ShareJobStrip } from "@/components/patterns/share-job-strip";
import { intentJob } from "@/modules/share";
import { ResumeUploadForm } from "./upload-form";

export default async function ResumePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  // Arrived from a share link's Apply (Phase U4): the job stays in view.
  const job = await intentJob();

  return (
    <Screen>
      {job ? <ShareJobStrip company={job.company} logoUrl={job.logoUrl} title={job.title} /> : null}
      <ResumeUploadForm
        forJob={Boolean(job)}
        signOut={
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/sign-in" });
            }}
          >
            <Button type="submit" variant="quiet" size="text" className="text-sm">
              Sign out
            </Button>
          </form>
        }
      />
    </Screen>
  );
}
