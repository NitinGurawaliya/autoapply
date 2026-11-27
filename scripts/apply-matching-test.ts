// Apply to all that fit (Phase X, X5, docs/feed/TDD.md 4.5): applyToAll sends best first through swipeRight, stops at
// the weekly cap for one company before swiping anything over it, and every sent job has its governance events.
// Temporary test users (isTest) and mock jobs; the queue is held, so no application runs. npx tsx scripts/apply-matching-test.ts
import { db } from "../src/lib/db";
import { deleteAccount } from "../src/modules/account";
import { applyToAll, cancelApplication, swipeRight } from "../src/modules/apply/lifecycle";
import { loadRules } from "../src/modules/governance";

let failed = 0;
function ok(name: string, pass: boolean, detail = "") {
  if (!pass) failed += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const stamp = Date.now();
const hold = async () => "held";

async function person(tag: string) {
  const user = await db.user.create({ data: { email: `x5-${tag}-${stamp}@swipeapply.local`, name: "x5" } });
  await db.profile.create({ data: { userId: user.id, isTest: true, resumeKey: "x", resumeText: "x", fullName: "X5", email: user.email, currentTitle: "Software Engineer", yearsExperience: 1, skills: [], experience: [], education: [], rawJson: {} } });
  return user;
}

async function main() {
  const perWeek = loadRules().max_per_company_per_week;
  const total = perWeek + 3;
  const company = await db.company.create({ data: { source: "mock", slug: `x5-${stamp}`, name: `X5 Co ${stamp}`, active: false } });
  const jobs = [];
  for (let i = 0; i < total; i += 1) {
    jobs.push(
      await db.job.create({
        data: { source: "mock", externalId: `x5-${i}-${stamp}`, companyId: company.id, title: `Software Engineer ${String.fromCharCode(65 + i)} Platform ${i}`, location: "Bengaluru, India", country: "IN", remoteType: "unknown", description: "Software Engineer. 0-2 years of experience.", applyUrl: "http://localhost:3000/mock/greenhouse", postedAt: new Date(), fetchedAt: new Date(), raw: {} },
      }),
    );
  }
  const users: string[] = [];
  try {
    const one = await person("one");
    users.push(one.id);
    // Best first is the order given (the page sorts by score): here, the reverse of creation.
    const order = [...jobs].reverse().map((job) => job.id);
    const first = await applyToAll(one.id, order, hold);
    ok(`sends ${perWeek}, the weekly cap for one company`, first.sent.length === perWeek, JSON.stringify({ ...first, sent: first.sent.length }));
    ok("holds the rest and names the cap", first.held === total - perWeek && first.heldBy === "max_per_company_per_week");
    const sentJobs = (await db.application.findMany({ where: { id: { in: first.sent } }, select: { id: true, jobId: true } })).map((app) => app.jobId);
    ok("best first: the first jobs given are the ones sent", sentJobs.sort().join() === order.slice(0, perWeek).sort().join());
    const swipes = await db.swipe.count({ where: { userId: one.id } });
    const blocked = await db.application.count({ where: { userId: one.id, status: "blocked" } });
    ok("a held job is never swiped, so it can be applied to next week", swipes === perWeek && blocked === 0, `${swipes} swipes, ${blocked} blocked`);
    const events = await db.applicationEvent.groupBy({ by: ["applicationId"], where: { applicationId: { in: first.sent } }, _count: true });
    ok("every sent application has its governance events", events.length === perWeek && events.every((row) => row._count > 0));
    const again = await applyToAll(one.id, order.slice(perWeek), hold);
    ok("a second tap the same week sends none and says why", again.sent.length === 0 && again.held === total - perWeek && again.heldBy === "max_per_company_per_week" && (await db.swipe.count({ where: { userId: one.id } })) === perWeek);

    // Already applied to one: it is skipped, and the room left is the cap minus that one.
    const two = await person("two");
    users.push(two.id);
    const before = await swipeRight(two.id, jobs[0].id, hold);
    const mixed = await applyToAll(two.id, jobs.map((job) => job.id), hold);
    ok("an already applied job is skipped and counts toward the cap", before.ok && mixed.skipped === 1 && mixed.sent.length === perWeek - 1 && mixed.heldBy === "max_per_company_per_week", JSON.stringify({ ...mixed, sent: mixed.sent.length }));
    ok("nothing to send: empty", (await applyToAll(two.id, [], hold)).sent.length === 0);
  } finally {
    for (const userId of users) {
      const apps = await db.application.findMany({ where: { userId }, select: { id: true } });
      for (const app of apps) await cancelApplication(app.id, userId).catch(() => undefined);
      await deleteAccount(userId).catch(() => undefined);
    }
    await db.job.deleteMany({ where: { companyId: company.id } });
    await db.company.delete({ where: { id: company.id } });
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS apply-matching-test" : `FAIL apply-matching-test (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
