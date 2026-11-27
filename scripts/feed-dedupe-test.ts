// The feed's one-card-per-role rule and the duplicate/weekly-cap guards count the employer, not the name
// (modules/jobs/match.ts dedupeListings, modules/governance/history.ts; docs/employers/TDD.md 4.8, W4).
// Fixtures are throwaway rows on the test account; nothing is queued or sent. npx tsx scripts/feed-dedupe-test.ts
import { db } from "../src/lib/db";
import { employerKey, historyFor, roleKey } from "../src/modules/governance";
import { dedupeListings } from "../src/modules/jobs/match";
import { PER_EMPLOYER, spreadEmployers } from "../src/modules/jobs/daily";

let failed = 0;
function ok(name: string, pass: boolean, detail = "") {
  if (!pass) failed += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

type Row = { roleKey: string; location: string; source: string; daysAgo: number; id: string };
const row = (id: string, source: string, employerId: string | null, companyId: string, title: string): Row => ({ id, source, location: "Bengaluru", daysAgo: 2, roleKey: roleKey(employerKey({ employerId, companyId }), title) });

async function main() {
  // 1. One employer's same role on Greenhouse and Naukri is one card: the Greenhouse one (either order of arrival).
  const same = dedupeListings([row("n", "naukri", "E1", "c-naukri", "Backend Engineer"), row("g", "greenhouse", "E1", "c-gh", "Backend Engineer")]);
  ok("1. one card, the Greenhouse listing", same.length === 1 && same[0]?.id === "g", same.map((r) => r.id).join(","));
  const reversed = dedupeListings([row("g", "greenhouse", "E1", "c-gh", "Backend Engineer"), row("n", "naukri", "E1", "c-naukri", "Backend Engineer")]);
  ok("1. the same when the Greenhouse one arrives first", reversed.length === 1 && reversed[0]?.id === "g");
  const ranked = dedupeListings([row("w", "workday", "E1", "c-w", "Analyst"), row("s", "smartrecruiters", "E1", "c-s", "Analyst"), row("k", "keka", "E1", "c-k", "Analyst")]);
  ok("1. among the other boards, SmartRecruiters then Keka then Workday", ranked.length === 1 && ranked[0]?.id === "s", ranked.map((r) => r.id).join(","));

  // 2. Two employers that share a name, same title: two cards.
  const glides = dedupeListings([row("a", "ashby", "E-glide-1", "c-a", "Product Designer"), row("l", "lever", "E-glide-2", "c-l", "Product Designer")]);
  ok("2. two employers named Glide, same title: two cards", glides.length === 2);

  // 6 (Phase X, X6). Today's set takes at most PER_EMPLOYER jobs of one employer, in rank order.
  const ranked6 = [
    { id: "a1", employerId: "EA", companyId: "c1" },
    { id: "a2", employerId: "EA", companyId: "c2" },
    { id: "a3", employerId: "EA", companyId: "c1" },
    { id: "b1", employerId: "EB", companyId: "c3" },
    { id: "u1", employerId: null, companyId: "c9" },
    { id: "b2", employerId: "EB", companyId: "c3" },
    { id: "b3", employerId: "EB", companyId: "c4" },
  ];
  const spread = spreadEmployers(ranked6, employerKey, PER_EMPLOYER, 12).map((job) => job.id);
  ok(`6. at most ${PER_EMPLOYER} per employer, rank order kept, across its board accounts`, spread.join() === "a1,a2,b1,u1,b2", spread.join());
  ok("6. the set stops at its size", spreadEmployers(ranked6, employerKey, PER_EMPLOYER, 3).map((job) => job.id).join() === "a1,a2,b1");

  // 5 (pure half). An unlinked company never matches another by name.
  const unlinked = dedupeListings([row("x", "greenhouse", null, "c-x", "Designer"), row("y", "lever", null, "c-y", "Designer")]);
  ok("5. two unlinked companies with one title stay two cards", unlinked.length === 2);
  ok("5. an unlinked company counts as its own board account", employerKey({ employerId: null, companyId: "c-x" }) === "c:c-x" && employerKey({ employerId: "E", companyId: "c-x" }) === "e:E");

  // 3-5 on the database: the guards read the employer through the application's job's company.
  const user = await db.user.findUnique({ where: { email: "t12-check@swipeapply.local" } });
  if (!user) throw new Error("test user missing");
  const stamp = Date.now();
  const employer = await db.employer.create({ data: { slug: `w4-${stamp}`, name: `W4 ${stamp}`, nameKey: `w4${stamp}`, domain: `w4-${stamp}.example.com` } });
  const mkCompany = (tag: string, employerId: string | null, name = `W4 Co ${stamp}`) => db.company.create({ data: { source: "mock", slug: `w4-${stamp}-${tag}`, name, active: false, employerId } });
  const c1 = await mkCompany("a", employer.id);
  const c2 = await mkCompany("b", employer.id, `W4 Co ${stamp} India Private Limited`); // another spelling, same employer
  const u1 = await mkCompany("u1", null, `W4 Same Name ${stamp}`);
  const u2 = await mkCompany("u2", null, `W4 Same Name ${stamp}`); // same name, not linked: a different company
  const now = new Date();
  const mkJob = (companyId: string, tag: string, title: string) =>
    db.job.create({ data: { source: "mock", externalId: `w4-${stamp}-${tag}`, companyId, title, location: "Remote", country: "REMOTE", remoteType: "remote", description: "Fixture", applyUrl: "http://localhost:3000/mock/greenhouse", postedAt: now, fetchedAt: now, raw: {} } });
  const jobs = {
    j1: await mkJob(c1.id, "j1", "Backend Engineer"),
    j2: await mkJob(c2.id, "j2", "Backend  Engineer!"), // the same role on the employer's other board account
    j3: await mkJob(c1.id, "j3", "Data Engineer"),
    j4: await mkJob(c2.id, "j4", "QA Engineer"),
    j5: await mkJob(c2.id, "j5", "Support Engineer"),
    k1: await mkJob(u1.id, "k1", "Designer"),
    k2: await mkJob(u2.id, "k2", "Designer"),
  };
  const created: string[] = [];
  const apply = async (jobId: string, status = "submitted") => {
    const app = await db.application.create({ data: { userId: user.id, jobId, status, createdAt: new Date(), fields: [], pendingQuestions: [] } });
    created.push(app.id);
    return app;
  };
  try {
    await apply(jobs.j1.id);
    const dup = await historyFor(user.id, { title: jobs.j2.title, companyId: c2.id });
    ok("3. a role applied to on one board account is a duplicate on the employer's other", dup.duplicateRole, `week count ${dup.companyWeekCount}`);

    await apply(jobs.j3.id);
    await apply(jobs.j4.id, "queued");
    const week = await historyFor(user.id, { title: jobs.j5.title, companyId: c2.id });
    ok("4. three applications this week across two board accounts: the employer's count is 3", week.companyWeekCount === 3, String(week.companyWeekCount));

    const other = await historyFor(user.id, { title: jobs.k2.title, companyId: u2.id });
    ok("5. an unrelated unlinked company has no history", !other.duplicateRole && other.companyWeekCount === 0);
    await apply(jobs.k1.id);
    const sameName = await historyFor(user.id, { title: jobs.k2.title, companyId: u2.id });
    ok("5. a same-name unlinked company is not the same role", !sameName.duplicateRole && sameName.companyWeekCount === 0, `dup ${sameName.duplicateRole}, count ${sameName.companyWeekCount}`);
    const own = await historyFor(user.id, { title: jobs.k1.title, companyId: u1.id });
    ok("5. the company itself still is", own.duplicateRole && own.companyWeekCount === 1);
  } finally {
    await db.applicationEvent.deleteMany({ where: { applicationId: { in: created } } });
    await db.application.deleteMany({ where: { id: { in: created } } });
    await db.job.deleteMany({ where: { id: { in: Object.values(jobs).map((job) => job.id) } } });
    await db.company.deleteMany({ where: { id: { in: [c1.id, c2.id, u1.id, u2.id] } } });
    await db.employer.delete({ where: { id: employer.id } });
  }
  console.log(failed === 0 ? "PASS feed-dedupe-test" : `FAIL feed-dedupe-test (${failed})`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
