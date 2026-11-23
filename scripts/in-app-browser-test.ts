// Phase U8: in-app browsers (src/lib/in-app-browser.ts). User agents in the formats these apps send (their markers:
// [LinkedInApp], Instagram, FBAN/FBAV/FB_IAB, TwitterAndroid); the owner's phone check confirms them on real devices.
// npx tsx scripts/in-app-browser-test.ts
import { chromeIntentUrl, inAppBrowser } from "../src/lib/in-app-browser";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const CASES: Array<[string, string, string | null, string | null]> = [
  ["LinkedIn, Android", "Mozilla/5.0 (Linux; Android 13; SM-S911B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36 [LinkedInApp]/4.1.882", "LinkedIn", "android"],
  ["LinkedIn, iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.29.6542", "LinkedIn", "ios"],
  ["Instagram, Android", "Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SD1A.210817.036; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/94.0.4606.71 Mobile Safari/537.36 Instagram 212.0.0.38.119 Android (31/12; 420dpi; 1080x2209; Google/google; Pixel 6; oriole; oriole; en_US; 329675731)", "Instagram", "android"],
  ["Instagram, iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 289.0.0.25.115 (iPhone14,5; iOS 16_5; en_US; en; scale=3.00; 1170x2532; 487435437)", "Instagram", "ios"],
  ["Facebook, iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone13,2;FBMD/iPhone;FBSN/iOS;FBSV/16.6;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]", "Facebook", "ios"],
  ["Facebook, Android", "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UD1A.230803.041; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.5845.163 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/430.0.0.23.113;]", "Facebook", "android"],
  ["X, Android", "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.43 Mobile Safari/537.36 TwitterAndroid", "X", "android"],
  ["Chrome, Android", "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36", null, null],
  ["Safari, iPhone (also X's link view)", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1", null, null],
  ["Chrome, iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1", null, null],
  ["Chrome, desktop", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", null, null],
  ["no user agent", "", null, null],
];

for (const [name, ua, app, os] of CASES) {
  const found = inAppBrowser(ua);
  check(name, (found?.app ?? null) === app && (found?.os ?? null) === os, JSON.stringify(found));
}

const intent = chromeIntentUrl("https://swipeapply.example/j/razorpay-backend-engineer-cmh3k2x9p0001abcd1234efgh?s=li");
check(
  "the Chrome intent keeps host, path, query and scheme",
  intent.startsWith("intent://swipeapply.example/j/razorpay-backend-engineer-cmh3k2x9p0001abcd1234efgh?s=li#Intent;scheme=https;package=com.android.chrome;") && intent.endsWith(";end"),
  intent,
);
check("and falls back to the same page", intent.includes(`S.browser_fallback_url=${encodeURIComponent("https://swipeapply.example/j/razorpay-backend-engineer-cmh3k2x9p0001abcd1234efgh?s=li")}`));

console.log(failed === 0 ? "PASS in-app-browser-test" : `FAIL in-app-browser-test (${failed})`);
process.exit(failed === 0 ? 0 : 1);
