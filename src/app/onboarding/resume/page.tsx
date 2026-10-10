import { redirect } from "next/navigation";
import { getCurrentUser, signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/patterns/layout";
import { ResumeUploadForm } from "./upload-form";

export default async function ResumePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  return (
    <Screen>
      <ResumeUploadForm
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
