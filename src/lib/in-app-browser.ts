/**
 * In-app browsers (share links, Phase U8, docs/share/TDD.md §4.6): Google refuses sign-in inside an app's embedded web
 * view (`disallowed_useragent`), so a signed-out visitor there is asked to open the page in their browser first. Read
 * from the user agent, which these apps mark: LinkedIn `[LinkedInApp]`, Instagram `Instagram`, Facebook `FBAN` /
 * `FBAV` / `FB_IAB`, X on Android `TwitterAndroid`. X on iPhone opens links in Safari's own view, where Google works,
 * and its user agent is Safari's, so it is not caught and needs no catching.
 */

export type InAppBrowser = { app: "LinkedIn" | "X" | "Instagram" | "Facebook"; os: "android" | "ios" | "other" };

export function inAppBrowser(userAgent: string | null | undefined): InAppBrowser | null {
  const ua = userAgent ?? "";
  const app = /LinkedInApp/i.test(ua)
    ? "LinkedIn"
    : /Instagram/.test(ua)
      ? "Instagram"
      : /FBAN|FBAV|FB_IAB/.test(ua)
        ? "Facebook"
        : /TwitterAndroid/i.test(ua)
          ? "X"
          : null;
  if (!app) return null;
  const os = /Android/i.test(ua) ? "android" : /iPhone|iPad|iPod/i.test(ua) ? "ios" : "other";
  return { app, os };
}

/** An Android intent link that opens the same address in Chrome (or the default browser if Chrome is missing). */
export function chromeIntentUrl(absolute: string): string {
  const url = new URL(absolute);
  const fallback = encodeURIComponent(url.toString());
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${url.protocol.replace(":", "")};package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
}
