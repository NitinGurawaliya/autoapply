import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/content";
import { DeckEmptyArt } from "@/components/patterns/drawings";
import { Screen } from "@/components/patterns/layout";

// Any address the app does not have. Outside the signed-in shell (no session read, no tab bar), so it stays static.
export default function NotFound() {
  return (
    <Screen>
      <EmptyState
        art={<DeckEmptyArt />}
        title="This page doesn't exist"
        text="The link may be old or mistyped. Your feed is still here."
        actions={
          <Link href="/feed" className={buttonVariants({ variant: "primary", size: "xl", className: "w-full" })}>
            Go to your feed
          </Link>
        }
      />
    </Screen>
  );
}
