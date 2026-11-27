// K16: the per-site switches (src/lib/site-flags.ts) keep Naukri's env names and give every site the same three.
import { siteOn, sitesOn } from "../src/lib/site-flags";
import { sharedReaderOn } from "../src/modules/sources/reader";
import { plannerOf } from "../src/modules/jobs/fetchers/siteSearches";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const none = {};
check("nothing set: every switch is off", !siteOn("naukri", "feed", none) && !siteOn("naukri", "apply", none) && !siteOn("naukri", "reader", none));
check("ENABLE_NAUKRI turns the feed on, not apply", siteOn("naukri", "feed", { ENABLE_NAUKRI: "1" }) && !siteOn("naukri", "apply", { ENABLE_NAUKRI: "1" }));
check("apply needs both ENABLE_NAUKRI and ENABLE_NAUKRI_APPLY", siteOn("naukri", "apply", { ENABLE_NAUKRI: "1", ENABLE_NAUKRI_APPLY: "1" }) && !siteOn("naukri", "apply", { ENABLE_NAUKRI_APPLY: "1" }));
check("NAUKRI_READER is the reader switch", siteOn("naukri", "reader", { NAUKRI_READER: "1" }));
check("a value other than 1 is off", !siteOn("naukri", "feed", { ENABLE_NAUKRI: "true" }));
check("another site's switch does not turn Naukri on", !siteOn("naukri", "feed", { ENABLE_HIRIST: "1" }));
check("the names follow the site (hirist)", siteOn("hirist", "feed", { ENABLE_HIRIST: "1" }) && siteOn("hirist", "reader", { HIRIST_READER: "1" }));
check("sitesOn lists the registered sites that are on", JSON.stringify(sitesOn("feed", { ENABLE_NAUKRI: "1" })) === JSON.stringify(["naukri"]), JSON.stringify(sitesOn("feed", { ENABLE_NAUKRI: "1" })));
check("sharedReaderOn(site) and sharedReaderOn() agree with the env", sharedReaderOn("naukri", { NAUKRI_READER: "1" }) && sharedReaderOn(undefined, { NAUKRI_READER: "1" }) && !sharedReaderOn("naukri", none) && !sharedReaderOn(undefined, none));
const plan = plannerOf("naukri")({ tracks: ["backend"], currentTitle: null, city: "Pune", yearsExperience: 2 }, 3);
check("the planner for naukri (and a check's own naukri-smoke) plans searches", plan.length > 0 && plannerOf("naukri-smoke") === plannerOf("naukri"), `${plan.length} searches`);
let threw = false;
try {
  plannerOf("nowhere");
} catch {
  threw = true;
}
check("a site without a planner is an error, not a silent empty plan", threw);

console.log(failed === 0 ? "PASS site-flags-test" : `FAIL site-flags-test (${failed})`);
process.exit(failed === 0 ? 0 : 1);
