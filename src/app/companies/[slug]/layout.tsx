import type { ReactNode } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { employerRoute } from "@/modules/jobs/employer-pages";

/**
 * Whether the company exists is settled here, above this segment's loading screen: once a loading screen has started
 * the response its status is 200 whatever the page then does (Next's loading.md), and a missing company must be a
 * real 404 and an old address a real 308.
 */
export default async function CompanyLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const route = await employerRoute(slug);
  if (!route) notFound();
  if (route.kind === "redirect") permanentRedirect(`/companies/${route.slug}`);
  return children;
}
