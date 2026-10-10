// Per-company results: what a company's history says, how that nudges the feed order, and that only counts leave.
// Uses temporary companies, jobs and users. npx tsx scripts/results-test.ts
import { db } from "../src/lib/db";
import { deleteAccount } from "../src/modules/account";
import { clearCompanyResultsCache, judge, listFeed, loadCompanyResults, parseFeedFilters } from "../src/modules/jobs";
import type { CompanyResult } from "../src/modules/jobs";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const stamp = Date.now();
const base: CompanyResult = { companyId: "c", company: "C", source: "greenhouse", submitted: 0, failed: 0, finished: 0, codeAsked: 0 };

async function main() {
  // ---- the judgement, offline
  check("too little history says nothing", judge({ ...base, finished: 2, submitted: 2 }).hint === null && judge({ ...base, finished: 2, submitted: 2 }).nudge === 0 && judge(undefined).nudge === 0);
  check("a company that usually asks for a code is flagged and nudged down", judge({ ...base, finished: 4, submitted: 4, codeAsked: 3 }).hint === "Usually needs an emailed code" && judge({ ...base, finished: 4, submitted: 4, codeAsked: 3 }).nudge < 0);
  check("a company that often fails is flagged and nudged down harder", judge({ ...base, finished: 5, submitted: 1, failed: 4 }).hint === "Often fails to submit" && judge({ ...base, finished: 5, submitted: 1, failed: 4 }).nudge < -2);
  check("a company that reliably works with no code is nudged up, with no warning", judge({ ...base, finished: 4, submitted: 4 }).nudge > 0 && judge({ ...base, finished: 4, submitted: 4 }).hint === null);
  check("a mixed record is left alone", judge({ ...base, finished: 5, submitted: 3, failed: 2, codeAsked: 1 }).nudge === 0 && judge({ ...base, finished: 5, submitted: 3, failed: 2, codeAsked: 1 }).hint === null);

  // ---- real data
  // A title no real job has, so real listings never crowd the three test jobs out of the 40 cards.
  const users = await Promise.all(["a", "viewer"].map((label) => db.user.create({ data: { email: `res-${label}-${stamp}@swipeapply.local`, name: label } })));
  const [actor, viewer] = users;
  await db.profile.create({ data: { userId: viewer.id, resumeKey: "x", resumeText: "x", fullName: "Viewer", email: viewer.email, currentTitle: "Quokka Wrangler", yearsExperience: 1, skills: [], experience: [], education: [], rawJson: {} } });
  const companies = await Promise.all(["x", "y", "z"].map((n) => db.company.create({ data: { source: "greenhouse", slug: `results-${n}-${stamp}`, name: `Results ${n.toUpperCase()}`, active: false } })));
  const [X, Y, Z] = companies;
  const job = (companyId: string, n: string) =>
    db.job.create({ data: { source: "greenhouse", externalId: `res-${n}-${stamp}`, companyId, title: "Quokka Wrangler", location: "Bengaluru, India", country: "IN", eligibility: "india", function: "engineering", track: "software", remoteType: "unknown", description: "Quokka Wrangler role. 0-2 years of experience.", applyUrl: "https://job-boards.greenhouse.io/x/jobs/1", postedAt: new Date(), fetchedAt: new Date(), raw: {} } });
  const jobs = { x: await job(X.id, "x"), y: await job(Y.id, "y"), z: await job(Z.id, "z") };
  const run = async (jobId: string, status: string, codeAsked: boolean) => {
    const app = await db.application.create({ data: { userId: actor.id, jobId, status, fields: [], pendingQuestions: [] } });
    if (codeAsked) await db.applicationEvent.create({ data: { applicationId: app.id, type: "ask_user", message: "Waiting for the emailed security code" } });
    return app;
  };
  try {
    // X: 4 runs, 3 asked for a code. Y: 3 clean submits. Z: only 2 runs.
    for (let i = 0; i < 3; i += 1) await run(jobs.x.id, "submitted", true);
    await run(jobs.x.id, "failed", false);
    for (let i = 0; i < 3; i += 1) await run(jobs.y.id, "submitted", false);
    await run(jobs.z.id, "submitted", false);
    await run(jobs.z.id, "submitted", false);
    await run(jobs.z.id, "cancelled", false); // cancelled runs say nothing about the company

    const results = await loadCompanyResults();
    const rx = results.find((r) => r.companyId === X.id);
    const ry = results.find((r) => r.companyId === Y.id);
    const rz = results.find((r) => r.companyId === Z.id);
    check("counts per company are right", rx?.finished === 4 && rx.submitted === 3 && rx.failed === 1 && rx.codeAsked === 3 && ry?.finished === 3 && ry.codeAsked === 0, JSON.stringify(rx));
    check("a cancelled run is not counted", rz?.finished === 2);
    check("only counts and the company name leave the module", results.every((r) => Object.keys(r).sort().join(",") === "codeAsked,company,companyId,failed,finished,source,submitted"));
    check("the mock form is never part of the picture", !results.some((r) => r.source === "mock"));

    // ---- the feed
    clearCompanyResultsCache();
    const feed = await listFeed(viewer.id, parseFeedFilters({}));
    const at = (id: string) => feed.findIndex((f) => f.id === id);
    const [fx, fy, fz] = [feed[at(jobs.x.id)], feed[at(jobs.y.id)], feed[at(jobs.z.id)]];
    check("all three jobs are in the feed with the same honest score", !!fx && !!fy && !!fz && fx.score === fy.score && fy.score === fz.score, `${fx?.score} ${fy?.score} ${fz?.score}`);
    check("the reliable company ranks above the unknown, which ranks above the code-heavy one", at(jobs.y.id) < at(jobs.z.id) && at(jobs.z.id) < at(jobs.x.id), `${at(jobs.y.id)} ${at(jobs.z.id)} ${at(jobs.x.id)}`);
    check("only the code-heavy company carries a hint", fx?.hint === "Usually needs an emailed code" && fy?.hint === null && fz?.hint === null);
    check("the ranking number never leaks into the feed data", !("rank" in (fx ?? {})));
  } finally {
    await db.job.deleteMany({ where: { companyId: { in: companies.map((c) => c.id) } } });
    await db.company.deleteMany({ where: { id: { in: companies.map((c) => c.id) } } });
    for (const u of users) await deleteAccount(u.id).catch(() => undefined);
    clearCompanyResultsCache();
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS results" : `FAIL results (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
