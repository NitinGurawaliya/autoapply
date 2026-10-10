import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export function SignOutForm() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/sign-in" });
      }}
    >
      <Button type="submit" variant="plain" size="row" className="w-full">
        Sign out
      </Button>
    </form>
  );
}
