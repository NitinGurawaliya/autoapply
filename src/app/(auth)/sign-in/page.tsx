import { cookies } from "next/headers";
import { signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { SignInScreen } from "./sign-in-screen";
import { SPLASH_COOKIE } from "./splash-cookie";

export default async function SignInPage() {
  const seen = (await cookies()).get(SPLASH_COOKIE)?.value === "1";
  return (
    <SignInScreen
      showSplash={!seen}
      signIn={
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <Button type="submit" variant="primary" size="xl" className="w-full gap-3">
            <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full bg-primary-foreground text-xs font-bold text-primary">
              G
            </span>
            Continue with Google
          </Button>
        </form>
      }
    />
  );
}
