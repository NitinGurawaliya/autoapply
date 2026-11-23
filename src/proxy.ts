import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { mockFormEnabled } from "@/lib/mock-gate";
import { shareLinksEnabled } from "@/lib/share-gate";
import { newVisitorId, VISITOR_COOKIE, VISITOR_MAX_AGE_S } from "@/lib/visitor";

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  // Switched off (production): a real 404 status, not a "not found" page answered with 200 (16 Oct QA).
  if (pathname.startsWith("/mock")) return mockFormEnabled() ? NextResponse.next() : new NextResponse("Not found", { status: 404 });
  // The UI gallery (src/app/dev/ui) holds no data and is a 404 in production: open it without signing in in development.
  if (pathname.startsWith("/dev/") && process.env.NODE_ENV !== "production") return NextResponse.next();
  // Share links (Phase U): public for everyone, signed in or not, with or without a profile; a 404 while switched off.
  if (pathname.startsWith("/j/")) {
    if (!shareLinksEnabled()) return new NextResponse("Not found", { status: 404 });
    if (req.cookies.get(VISITOR_COOKIE)) return NextResponse.next();
    // The funnel's random visitor id (U7): set on the response, and on this request so the page already sees it.
    const id = newVisitorId();
    const headers = new Headers(req.headers);
    headers.set("cookie", [req.headers.get("cookie"), `${VISITOR_COOKIE}=${id}`].filter(Boolean).join("; "));
    const response = NextResponse.next({ request: { headers } });
    response.cookies.set(VISITOR_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: VISITOR_MAX_AGE_S });
    return response;
  }

  const signedIn = Boolean(req.auth?.user?.id);

  if (!signedIn) {
    if (pathname === "/sign-in") return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // The session read already says whether a profile exists (lib/auth.ts getSessionAndUser): no query here.
  const profile = req.auth!.user!.hasProfile;
  const home = profile ? "/feed" : "/onboarding/resume";

  if (pathname === "/sign-in" || pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = home;
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Account stays open without a profile, so someone who never finished onboarding can still export or delete their
  // data (16 Oct QA).
  if (!profile && pathname !== "/onboarding/resume" && pathname !== "/account") {
    const url = req.nextUrl.clone();
    url.pathname = "/onboarding/resume";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
