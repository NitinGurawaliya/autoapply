import { redirect } from "next/navigation";

// The proxy sends "/" to the feed or to onboarding before this renders; this is only the fallback.
export default function Home() {
  redirect("/feed");
}
