// Duplicate-role and per-company guards, daily counter, and the feed hiding applied roles.
// Uses fixture jobs on the test account; nothing is queued or sent. npx tsx scripts/guards-test.ts
import { db } from "../src/lib/db";
import { appliedRoleKeys, check, companyKey, dailyUsage, historyFor, roleKey } from "../src/modules/governance";
import { listFeed, parseFeedFilters } from "../src/modules/jobs";

let failed = 0;
function ok(name: string, pass: boolean, detail = "") {
  if (!pass) failed += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

async function main() {
  const user = await db.user.findUnique({ where: { email: "t12-check@swipeapply.local" } });
  if (!user) throw new Error("test user missing");
  const slug = `guard-test-${Date.now()}`;
  const company = await db.company.create({ data: { source: "mock", slug, name: "Guard Test Co", active: false } });
  const make = (externalId: string, title: string) =>
    db.job.create({
      data: {
        source: "mock", externalId: `${slug}-${externalId}`, companyId: company.id, title, location: "Remote", country: "REMOTE",
        remoteType: "remote", description: "Fixture", applyUrl: "http://localhost:3000/mock/greenhouse", postedAt: new Date(), fetchedAt: new Date(), raw: {},
      },
    });
  const jobs = {
    a: await make("a", "Software Engineer"),
    dupe: await make("dupe", "Software  Engineer!"), // same role once normalised, different id
    b: await make("b", "Data Engineer"),
    c: await make("c", "QA Engineer"),
    d: await make("d", "Support Engineer"),
  };
  const created: string[] = [];
  const apply = async (jobId: string, status: string, createdAt = new Date()) => {
    const app = await db.application.create({ data: { userId: user.id, jobId, status, createdAt, fields: [], pendingQuestions: [] } });
    created.push(app.id);
    return app;
  };

  try {
    // The feed only returns the top 40, so fixtures are checked through the same key the feed filters on.
    const feedHas = async (id: string) => (await listFeed(user.id, parseFeedFilters({ days: "30" }))).some((job) => job.id === id);
    const key = (job: { title: string }) => roleKey(companyKey(company.name), job.title);
    ok("before applying, no role at the company is marked applied", !(await appliedRoleKeys(user.id)).has(key(jobs.a)));

    const first = await apply(jobs.a.id, "submitted");
    const applied = await appliedRoleKeys(user.id);
    ok("the applied role and its duplicate listing share one key the feed hides", applied.has(key(jobs.a)) && applied.has(key(jobs.dupe)));
    ok("a different role at that company is not hidden", !applied.has(key(jobs.b)));
    ok("the feed does not return the applied role or its duplicate", !(await feedHas(jobs.a.id)) && !(await feedHas(jobs.dupe.id)));

    const probe = await apply(jobs.dupe.id, "queued");
    const history = await historyFor(user.id, { title: jobs.dupe.title, companyId: company.id });
    ok("same role under another id counts as a duplicate", history.duplicateRole);
    const blocked = await check("swipe_right", { applicationId: probe.id, profileExists: true, score: 90, ...history });
    ok("duplicate swipe is blocked with the rule name", !blocked.ok && blocked.rule === "no_duplicate_role", String(blocked.rule));

    // Remove the probe so the next checks only see real history.
    await db.applicationEvent.deleteMany({ where: { applicationId: probe.id } });
    await db.application.delete({ where: { id: probe.id } });
    created.splice(created.indexOf(probe.id), 1);

    await apply(jobs.b.id, "needs_input");
    await apply(jobs.c.id, "queued");
    const weekHistory = await historyFor(user.id, { title: jobs.d.title, companyId: company.id });
    ok("company count covers the last 7 days", weekHistory.companyWeekCount === 3, `${weekHistory.companyWeekCount}`);
    const probe2 = await apply(jobs.d.id, "queued");
    const capped = await check("swipe_right", { applicationId: probe2.id, profileExists: true, score: 90, ...weekHistory });
    ok("a fourth role at one company in a week is blocked", !capped.ok && capped.rule === "max_per_company_per_week", String(capped.rule));
    await db.applicationEvent.deleteMany({ where: { applicationId: probe2.id } });
    await db.application.delete({ where: { id: probe2.id } });
    created.splice(created.indexOf(probe2.id), 1);

    // Old applications and failed ones do not count.
    const eightDays = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db.application.update({ where: { id: first.id }, data: { createdAt: eightDays } });
    const later = await historyFor(user.id, { title: jobs.d.title, companyId: company.id });
    ok("applications older than 7 days stop counting toward the weekly limit", later.companyWeekCount === 2, `${later.companyWeekCount}`);
    ok("but the role stays a duplicate forever", (await historyFor(user.id, { title: jobs.a.title, companyId: company.id })).duplicateRole);

    const before = await dailyUsage(user.id);
    await apply(jobs.d.id, "failed");
    ok("daily counter counts every application created today", (await dailyUsage(user.id)) === before + 1);
    const failedOnly = await historyFor(user.id, { title: jobs.d.title, companyId: company.id });
    ok("a failed application does not make a role a duplicate", !failedOnly.duplicateRole);
  } catch (error) {
    failed += 1;
    console.log("FAIL", error instanceof Error ? error.message.split("\n")[0] : error);
  } finally {
    await db.applicationEvent.deleteMany({ where: { applicationId: { in: created } } });
    await db.application.deleteMany({ where: { id: { in: created } } });
    await db.job.deleteMany({ where: { companyId: company.id } });
    await db.company.delete({ where: { id: company.id } });
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS guards" : `FAIL guards (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
