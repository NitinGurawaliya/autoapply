import type { Metadata } from "next";
import { Screen } from "@/components/patterns/layout";
import { ShareTopBar } from "@/app/j/[slug]/share-sections";
import { absoluteUrl } from "@/lib/job-slug";
import { letterCounts, topEmployers } from "@/modules/jobs/employer-pages";
import { EmployerList, JsonLd, LetterStrip } from "../parts";

export const metadata: Metadata = {
  title: "Companies hiring | SwipeApply",
  description: "Companies with open jobs, A to Z. Upload your resume once and your agent applies for you.",
  alternates: { canonical: absoluteUrl("/companies") },
  robots: { index: true, follow: true },
};

/** /companies (design/companies.html 1, Phase W6): the letters, and the employers with the most open jobs in India. */
export default async function CompaniesPage() {
  const [counts, top] = await Promise.all([letterCounts(), topEmployers(30)]);
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  return (
    <Screen className="px-5 pb-6">
      <JsonLd data={{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Companies", item: absoluteUrl("/companies") }] }} />
      <ShareTopBar right="sign-in" />
      <h1 className="m-0 mt-2 type-heading">Companies hiring</h1>
      <p className="m-0 mt-1.5 type-meta text-muted-foreground">
        <span className="tabular-nums">{total.toLocaleString("en-IN")}</span> {total === 1 ? "company" : "companies"} with open jobs
      </p>
      <LetterStrip counts={counts} />
      {top.length > 0 ? (
        <section className="mt-7">
          <h2 className="m-0 mb-2.5 type-section">Most hiring in India</h2>
          <EmployerList rows={top} />
          <p className="m-0 mt-2 type-meta text-muted-foreground">Open jobs in India, today.</p>
        </section>
      ) : null}
    </Screen>
  );
}
