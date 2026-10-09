// "Closed" is only believed when the company's own board agrees. Live public APIs, no login.
// npx tsx scripts/closed-test.ts
import { explainOutcome } from "../src/lib/explain";
import { listingState } from "../src/modules/jobs";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

async function main() {
  const board = (await (await fetch("https://api.ashbyhq.com/posting-api/job-board/posthog")).json()) as { jobs: Array<{ id: string }> };
  check("a job the Ashby board lists is listed", (await listingState("ashby", "posthog", board.jobs[0].id)) === "listed");
  check("a job the Ashby board does not list is gone", (await listingState("ashby", "posthog", "00000000-0000-0000-0000-000000000000")) === "gone");
  check("an unknown board says unknown, not closed", (await listingState("workday", "x", "1")) === "unknown");
  check("a missing Greenhouse job is gone", (await listingState("greenhouse", "stripe", "1")) === "gone");
  check("a missing Lever job is gone", (await listingState("lever", "paytm", "00000000-0000-0000-0000-000000000000")) === "gone");
  check("a board that cannot be reached is unknown", (await listingState("ashby", "no-such-company-zz9", "1")) !== "listed");
  check("a form that did not load is not called closed", explainOutcome("failed", "This company does not take applications on its job board page. Apply on its own careers site.").headline === "Apply on the company site");
  console.log(failed === 0 ? "PASS closed" : `FAIL closed (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
