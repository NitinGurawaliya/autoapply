import { signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export default function SignInPage() {
  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">SwipeApply</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Sign in with Google. A governed agent applies only after you swipe right.
      </p>
      <form
        className="mt-8"
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <Button type="submit" size="lg" className="w-full">
          Continue with Google
        </Button>
      </form>
    </main>
  );
}
