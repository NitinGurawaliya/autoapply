"use server";

import { revalidatePath } from "next/cache";

/**
 * Pages are kept in the browser for a minute after a visit (experimental.staleTimes in next.config.ts), so going back
 * and forth is instant. After the user changes something (an answer, the profile, a cancel or retry), call this:
 * it drops every kept page, so the next visit to any of them is fresh, and re-renders the current one.
 */
export async function forgetVisitedPages() {
  revalidatePath("/", "layout");
}
