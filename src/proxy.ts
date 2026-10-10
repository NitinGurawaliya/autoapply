import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/mock")) return NextResponse.next();

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

  if (!profile && pathname !== "/onboarding/resume") {
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
