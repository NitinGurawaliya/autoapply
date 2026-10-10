"use client";

import { useCallback, useState, type ReactNode } from "react";
import { SignInArt } from "@/components/patterns/drawings";
import { LogoMark, OpeningSplash } from "@/components/patterns/opening";
import { SPLASH_COOKIE } from "./splash-cookie";


/** Board 02: logo, the fanned cards, "Swipe right. We'll apply." and Google sign-in. Board 01 plays first, once. */
export function SignInScreen({ showSplash, signIn }: { showSplash: boolean; signIn: ReactNode }) {
  const [splash, setSplash] = useState(showSplash);
  const done = useCallback(() => {
    // Shown once per browser session; the server reads this so a returning visit goes straight to sign-in.
    document.cookie = `${SPLASH_COOKIE}=1; path=/; SameSite=Lax`;
    setSplash(false);
  }, []);

  return (
    <div className="mx-auto box-border flex min-h-dvh w-full max-w-[480px] flex-col bg-background px-6 pt-[max(24px,env(safe-area-inset-top))] pb-7 text-foreground">
      <LogoMark />
      <div className="mt-[26px]">
        <SignInArt />
      </div>
      <h1 className="m-0 mt-6 type-display-2xl">
        Swipe right.
        <br />
        We&apos;ll apply.
      </h1>
      <p className="m-0 mt-3.5 text-base leading-normal text-pretty text-muted-foreground">
        Upload your resume once. Our agent fills each form with your real details, and never makes anything up.
      </p>
      <div className="mt-auto pt-8">{signIn}</div>
      {splash ? <OpeningSplash onDone={done} /> : null}
    </div>
  );
}
