// The logo found in each board's page (modules/jobs/logos.ts). Sample markup as the boards wrote it on 24 Oct; no network.
import { logoFromHtml } from "../src/modules/jobs/logos";

const greenhouse = `<meta property="og:image" content="https://s7-recruiting.cdn.greenhouse.io/x/og.jpg"/><img src="https://s7-recruiting.cdn.greenhouse.io/external_greenhouse_job_boards/logos/400/307/300/original/Logo-01_(1).jpg?1700670705" alt="Arcesium LLC Logo" class="logo"/>`;
const lever = `<meta property="og:image" content="https://lever-client-logos.s3.us-west-2.amazonaws.com/banner.png" /><img alt="Saviynt logo" src="https://lever-client-logos.s3.us-west-2.amazonaws.com/ce99b770-1764798903876.png">`;
const ashby = `{"logoWordmarkImageUrl":"https://app.ashbyhq.com/api/images/org-theme-wordmark/a.png","logoSquareImageUrl":"https://app.ashbyhq.com/api/images/org-theme-logo/b.png"}`;

const checks: Array<[string, boolean]> = [
  ["greenhouse: the image marked class=logo", logoFromHtml("greenhouse", greenhouse)?.endsWith("Logo-01_(1).jpg?1700670705") === true],
  ["lever: the image whose alt says logo, not the og:image banner", logoFromHtml("lever", lever)?.endsWith("1764798903876.png") === true],
  ["ashby: the square logo, not the wordmark", logoFromHtml("ashby", ashby) === "https://app.ashbyhq.com/api/images/org-theme-logo/b.png"],
  ["greenhouse: a logo in its logo folder without the class", logoFromHtml("greenhouse", `<img src="https://s4-recruiting.cdn.greenhouse.io/job_board_renderer/banners/b.png"><img src="https://s4-recruiting.cdn.greenhouse.io/external_greenhouse_job_boards/logos/400/653/100/original/Logo.jpg?1" alt="66degrees">`)?.endsWith("Logo.jpg?1") === true],
  ["ashby: the wordmark when there is no square logo", logoFromHtml("ashby", `{"logoWordmarkImageUrl":"https://app.ashbyhq.com/w.png","logoSquareImageUrl":null}`) === "https://app.ashbyhq.com/w.png"],
  ["no logo marked: null (og:image alone is not used)", logoFromHtml("greenhouse", `<meta property="og:image" content="https://x/y.png"/><img src="https://x/z.png">`) === null],
  ["http (not https) is refused", logoFromHtml("greenhouse", `<img class="logo" src="http://x/y.png">`) === null],
  ["entities are decoded", logoFromHtml("greenhouse", `<img class="logo" src="https://x/y.png?a=1&amp;b=2">`) === "https://x/y.png?a=1&b=2"],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed += 1;
}
console.log(failed === 0 ? "PASS logos" : `FAIL logos (${failed})`);
process.exit(failed === 0 ? 0 : 1);
