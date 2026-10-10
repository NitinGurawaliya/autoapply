import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

// Every design primitive and pattern in every state, light and dark (docs/DESIGN.md). Not available in production.
export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
