// K15 (docs/naukri/TASKS.md#k15): lean pages for a signed-in site's window, offline.
//
// npx tsx scripts/naukri-lean-test.ts
//   What Chrome drops in a Naukri window (pictures, fonts, video, log pings, ads and analytics) and what it keeps (the
//   site's pages, scripts, styles and data calls, reCAPTCHA); and the Chrome background services the proxy forwarder
//   refuses (25 Nov: the optimization guide was 13.6 MB of a 14.8 MB page) while Google's sign-in and reCAPTCHA pass.
import { CHROME_BACKGROUND } from "../src/modules/apply/proxy-forwarder";
import { leanBlocks, leanEnabled } from "../src/modules/apply/sites/lean";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const dropped = [
  "https://static.naukimg.com/s/7/104/assets/images/logo.png",
  "https://img.naukimg.com/logo_images/groups/v1/123.gif",
  "https://static.naukimg.com/s/7/104/assets/fonts/inter.woff2?v=3",
  "https://media.naukri.com/media/jdmedia/x.jpg",
  "https://videocdn.naukri.com/v/1.mp4",
  "https://logs.naukri.com/log?e=1",
  "https://lg.naukri.com/x",
  "https://www.googletagmanager.com/gtm.js?id=GTM-1",
  "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
  "https://connect.facebook.net/en_US/fbevents.js",
  "https://images.unsplash.com/photo-1?w=800",
];
const kept = [
  "https://www.naukri.com/software-developer-jobs-in-bengaluru?experience=1&jobAge=7",
  "https://www.naukri.com/jobapi/v3/search?noOfResults=20",
  "https://www.naukri.com/jobapi/v4/job/123",
  "https://static.naukimg.com/s/7/104/j/app.min.js",
  "https://static.naukimg.com/s/7/104/c/app.min.css",
  "https://www.naukri.com/cloudgateway-workflow/workflow-services/apply-workflow/v1/apply",
  "https://www.google.com/recaptcha/api2/anchor?k=x",
  "https://www.gstatic.com/recaptcha/releases/x/recaptcha__en.js",
  "https://www.google.com/recaptcha/api2/payload?p=x",
];
for (const url of dropped) check(`dropped: ${new URL(url).host}${new URL(url).pathname.slice(0, 30)}`, leanBlocks("naukri", url));
for (const url of kept) check(`kept: ${new URL(url).host}${new URL(url).pathname.slice(0, 40)}`, !leanBlocks("naukri", url));
check("on unless SIGNED_IN_LEAN=0", leanEnabled({}) && !leanEnabled({ SIGNED_IN_LEAN: "0" }));

for (const host of ["optimizationguide-pa.googleapis.com", "update.googleapis.com", "safebrowsing.googleapis.com", "clients2.google.com", "redirector.gvt1.com", "beacons.gcp.gvt2.com"]) {
  check(`refused by the forwarder: ${host}`, CHROME_BACKGROUND.test(host));
}
for (const host of ["www.naukri.com", "static.naukimg.com", "www.google.com", "www.gstatic.com", "accounts.google.com", "apis.google.com"]) {
  check(`passed by the forwarder: ${host}`, !CHROME_BACKGROUND.test(host));
}

console.log(failed === 0 ? "PASS naukri-lean-test" : `FAIL naukri-lean-test (${failed})`);
process.exit(failed === 0 ? 0 : 1);
