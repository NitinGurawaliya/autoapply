// K4 (docs/naukri/TASKS.md#k4): Naukri's own Apply on real jobs, pressing nothing.
//
// npx tsx scripts/naukri-dry-run.ts --live you@example.com [count]
//   For a user whose Naukri account is connected (scripts/naukri-connect-smoke.ts --live), opens `count` (default 3)
//   open Naukri jobs from the Job table that apply on Naukri itself, in their own window, one at a time, a few seconds
//   apart: each must open signed in and show Naukri's Apply button. Nothing is pressed, typed or saved; the sign-in is
//   not written back. Needs a screen (the visible window).
import { db } from "../src/lib/db";
import { openBrowser } from "../src/modules/apply/browser";
import { readJobPage } from "../src/modules/apply/sites/naukriApply";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

async function live(email: string, count: number) {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error(`no user ${email}`);
  const connection = await db.siteConnection.findUnique({ where: { userId_site: { userId: user.id, site: "naukri" } } });
  check("the Naukri account is connected", connection?.status === "connected", connection?.status ?? "none");
  if (connection?.status !== "connected") return;
  const jobs = await db.job.findMany({ where: { source: "naukri", applyVia: null, closedAt: null }, orderBy: { fetchedAt: "desc" }, take: count, select: { title: true, applyUrl: true, company: { select: { name: true } } } });
  check(`${count} open Naukri jobs to look at`, jobs.length === count, `${jobs.length} found; run scripts/naukri-ingest-smoke.ts --live first`);
  for (const [index, job] of jobs.entries()) {
    const session = await openBrowser(job.applyUrl, user.id, { site: "naukri", persist: false });
    try {
      const read = await readJobPage(session.page);
      const what = read.kind === "state" ? read.state : `${read.stop}: ${read.detail}`;
      check(`${job.company.name} · ${job.title}: signed in, Apply on Naukri`, read.kind === "state" && (read.state === "apply" || read.state === "already_applied"), what);
    } finally {
      await session.close();
    }
    if (index < jobs.length - 1) await new Promise((resolve) => setTimeout(resolve, 4000 + Math.random() * 3000));
  }
}

async function main() {
  const [mode, email, count] = process.argv.slice(2);
  if (mode !== "--live" || !email) {
    console.log("usage: npx tsx scripts/naukri-dry-run.ts --live you@example.com [count]");
    process.exit(2);
  }
  await live(email, Math.max(1, Math.min(5, Number(count) || 3)));
  await db.$disconnect();
  console.log(failed === 0 ? "PASS naukri-dry-run" : `FAIL naukri-dry-run (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
