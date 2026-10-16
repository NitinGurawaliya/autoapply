import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { mockFormEnabled } from "@/lib/mock-gate";

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  // Switched off (production): a real 404 status, not a "not found" page answered with 200 (16 Oct QA).
  if (pathname.startsWith("/mock")) return mockFormEnabled() ? NextResponse.next() : new NextResponse("Not found", { status: 404 });

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
