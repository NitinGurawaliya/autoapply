import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { LETTERS } from "@/modules/jobs/employer-pages";

/** A letter that is not a letter is a real 404, settled above this segment's loading screen (see [slug]/layout.tsx). */
export default async function LetterLayout({ children, params }: { children: ReactNode; params: Promise<{ letter: string }> }) {
  const { letter } = await params;
  if (letter !== "0" && !LETTERS.includes(letter)) notFound();
  return children;
}
