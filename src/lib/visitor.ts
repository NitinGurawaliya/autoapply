import { cookies } from "next/headers";

/**
 * The share-link funnel's visitor id (Phase U7): random, first-party, set by the proxy on share pages
 * (`src/proxy.ts`), nothing derived from the person. Kept apart from `lib/funnel.ts` so the proxy never loads the
 * database client.
 */

export const VISITOR_COOKIE = "sa_vid";
export const VISITOR_MAX_AGE_S = 180 * 24 * 60 * 60;

export function newVisitorId() {
  return `v_${crypto.randomUUID().replace(/-/g, "")}`;
}

/** This request's visitor id, or null (server components, actions and route handlers). */
export async function visitorId(): Promise<string | null> {
  const value = (await cookies()).get(VISITOR_COOKIE)?.value ?? "";
  return /^v_[a-f0-9]{32}$/.test(value) ? value : null;
}
