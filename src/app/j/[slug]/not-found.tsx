import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/content";
import { DeckEmptyArt } from "@/components/patterns/drawings";
import { Screen } from "@/components/patterns/layout";

// A share link whose job is gone (or the links are switched off): no session read, so it stays static.
export default function ShareNotFound() {
  return (
    <Screen>
      <EmptyState
        art={<DeckEmptyArt />}
        title="This job isn't here"
        text="The link may be old or mistyped. New jobs come in every day."
        actions={
          <Link href="/" className={buttonVariants({ variant: "primary", size: "xl", className: "w-full" })}>
            See jobs for you
          </Link>
        }
      />
    </Screen>
  );
}
