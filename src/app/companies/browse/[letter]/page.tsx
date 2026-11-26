import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Screen } from "@/components/patterns/layout";
import { ShareTopBar } from "@/app/j/[slug]/share-sections";
import { absoluteUrl } from "@/lib/job-slug";
import { employersByLetter, LETTERS } from "@/modules/jobs/employer-pages";
import { Crumbs, EmployerList, JsonLd, letterLabel, Pager } from "../../parts";

type Props = { params: Promise<{ letter: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const valid = (letter: string) => letter === "0" || LETTERS.includes(letter);
const pageOf = (query: Record<string, string | string[] | undefined>) => Number(Array.isArray(query.page) ? query.page[0] : query.page) || 1;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { letter } = await params;
  if (!valid(letter)) return { title: "SwipeApply", robots: { index: false, follow: false } };
  const label = letterLabel(letter);
  return {
    title: `Companies starting with ${label} | SwipeApply`,
    description: `Companies starting with ${label} that have open jobs. Upload your resume once and your agent applies for you.`,
    alternates: { canonical: absoluteUrl(`/companies/browse/${letter}`) },
    robots: { index: true, follow: true },
  };
}

/** /companies/browse/<letter> (design/companies.html 2 and 6): alphabetical, 200 to a page. */
export default async function LetterPage({ params, searchParams }: Props) {
  const [{ letter }, query] = await Promise.all([params, searchParams]);
  if (!valid(letter)) notFound();
  const { rows, total, pages } = await employersByLetter(letter, pageOf(query));
  const page = Math.min(Math.max(1, pageOf(query)), pages || 1);
  const label = letterLabel(letter);
  const base = `/companies/browse/${letter}`;
  return (
    <Screen className="px-5 pb-6">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Companies", item: absoluteUrl("/companies") },
            { "@type": "ListItem", position: 2, name: `Companies starting with ${label}`, item: absoluteUrl(base) },
          ],
        }}
      />
      <ShareTopBar right="sign-in" />
      <Crumbs />
      <h1 className="m-0 type-heading">Companies starting with {label}</h1>
      {total > 0 ? (
        <>
          <p className="m-0 mt-1.5 type-meta text-muted-foreground">
            {total.toLocaleString("en-IN")} {total === 1 ? "company" : "companies"}
          </p>
          <div className="mt-5">
            <EmployerList rows={rows} />
            <Pager base={base} page={page} pages={pages} />
            <Link href="/companies" className="flex min-h-11 items-center type-body underline decoration-1 underline-offset-4">
              All companies
            </Link>
          </div>
        </>
      ) : (
        <div className="mt-12 flex flex-col items-center gap-2 text-center">
          <p className="m-0 type-section">No companies under {label} yet</p>
          <p className="m-0 type-body text-muted-foreground">Companies appear here while they have open jobs.</p>
          <Link href="/companies" className={buttonVariants({ variant: "plain", size: "xl", className: "mt-3 px-5" })}>
            All companies
          </Link>
        </div>
      )}
    </Screen>
  );
}
