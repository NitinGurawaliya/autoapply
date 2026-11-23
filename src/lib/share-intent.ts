import { cookies } from "next/headers";

/**
 * The job a person tapped Apply on from a share link (Phase U4, docs/share/TDD.md §3): carried through Google sign-in
 * and onboarding, whose redirects drop the query. A job id and nothing else, httpOnly, 2 hours, cleared once claimed.
 * Set only by the share page's Apply action (a POST), never by a page view. Writes work in server actions and route
 * handlers only; reads work anywhere on the server.
 */

export const SHARE_INTENT_COOKIE = "sa_intent";
const MAX_AGE_S = 2 * 60 * 60;
const ID = /^[a-z0-9]{20,40}$/;

export async function setShareIntent(jobId: string) {
  (await cookies()).set(SHARE_INTENT_COOKIE, jobId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

/** The job id the person last tapped Apply on, or null. */
export async function readShareIntent(): Promise<string | null> {
  const value = (await cookies()).get(SHARE_INTENT_COOKIE)?.value ?? "";
  return ID.test(value) ? value : null;
}

export async function clearShareIntent() {
  (await cookies()).delete(SHARE_INTENT_COOKIE);
}
