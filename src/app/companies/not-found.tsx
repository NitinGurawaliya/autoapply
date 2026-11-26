import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/content";
import { DeckEmptyArt } from "@/components/patterns/drawings";
import { Screen } from "@/components/patterns/layout";

// design/companies.html 7: a company with no open jobs and a wrong address are the same page (a real 404); it does not
// say which, because a company can come back. No session read, so it stays static.
export default function CompaniesNotFound() {
  return (
    <Screen>
      <EmptyState
        art={<DeckEmptyArt />}
        title="We can't find that company"
        text="It may have no open jobs right now."
        actions={
          <Link href="/companies" className={buttonVariants({ variant: "plain", size: "xl", className: "w-full" })}>
            All companies
          </Link>
        }
      />
    </Screen>
  );
}
