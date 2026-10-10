// Swiping right on many jobs at once: every swipe is tracked, none is lost, the queue cap holds under a burst.
// Uses a temporary test user and mock jobs. npx tsx scripts/swipe-batch-test.ts
// The limit is the lower of max_in_flight_per_user and max_applications_per_day in config/rules.json.
import { db } from "../src/lib/db";
import { deleteAccount } from "../src/modules/account";
import { cancelApplication, swipeRight } from "../src/modules/apply/lifecycle";
import { loadRules } from "../src/modules/governance";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const stamp = Date.now();
// Applications stay queued: no worker may take them while the cap is being measured.
const hold = async () => "held";

async function main() {
  // The burst stops at whichever limit is lower: the queue (max_in_flight_per_user) or the daily cap.
  const rules = loadRules();
  const queueFirst = rules.max_in_flight_per_user <= rules.max_applications_per_day;
  const cap = Math.min(rules.max_in_flight_per_user, rules.max_applications_per_day);
  const rule = queueFirst ? "max_in_flight" : "max_applications_per_day";
  const total = cap + 8;
  const user = await db.user.create({ data: { email: `batch-${stamp}@swipeapply.local`, name: "batch" } });
  await db.profile.create({ data: { userId: user.id, isTest: true, resumeKey: "x", resumeText: "x", fullName: "Batch", email: user.email, currentTitle: "Software Engineer", yearsExperience: 1, skills: [], experience: [], education: [], rawJson: {} } });
  const companyCount = Math.ceil(total / 3);
  const companies = await Promise.all(Array.from({ length: companyCount }, (_, i) => db.company.create({ data: { source: "mock", slug: `batch-${i}-${stamp}`, name: `Batch Co ${i} ${stamp}`, active: false } })));
  const jobs = await Promise.all(
    Array.from({ length: total + 1 }, (_, i) =>
      db.job.create({ data: { source: "mock", externalId: `batch-${i}-${stamp}`, companyId: companies[i % companyCount].id, title: `Software Engineer ${String.fromCharCode(65 + (i % 26))}${i}`, location: "Bengaluru, India", country: "IN", remoteType: "unknown", description: "Software Engineer. 0-2 years of experience.", applyUrl: "http://localhost:3000/mock/greenhouse", postedAt: new Date(), fetchedAt: new Date(), raw: {} } }),
    ),
  );
  const spare = jobs.pop()!;
  try {
    // A burst: swipes fired together.
    // Waves of 6 at the same moment (the database pool is small; a person cannot swipe faster than this anyway).
    const results: Awaited<ReturnType<typeof swipeRight>>[] = [];
    for (let i = 0; i < jobs.length; i += 6) results.push(...(await Promise.all(jobs.slice(i, i + 6).map((job) => swipeRight(user.id, job.id, hold)))));
    const accepted = results.filter((r) => r.ok);
    const refused = results.filter((r) => !r.ok && r.reason === "blocked" && r.rule === rule);
    check(`exactly ${cap} of ${total} simultaneous swipes were accepted (limit: ${rule})`, accepted.length === cap, `accepted ${accepted.length}`);
    check(`the rest were refused by ${rule}, nothing else`, refused.length === total - cap, `refused ${refused.length}`);
    const apps = await db.application.findMany({ where: { userId: user.id } });
    const queued = apps.filter((a) => a.status === "queued");
    check("every accepted swipe has exactly one queued application", queued.length === cap, `queued ${queued.length}`);
    const swipes = await db.swipe.count({ where: { userId: user.id } });
    if (queueFirst) {
      check("a swipe refused for a full queue is not recorded, so the job stays swipeable", apps.length === cap && swipes === cap, `apps ${apps.length}, swipes ${swipes}`);
    } else {
      check("a swipe over the daily cap is recorded as blocked with the rule name", apps.length === total && apps.filter((a) => a.status === "blocked" && a.error === rule).length === total - cap, `apps ${apps.length}`);
    }
    const again = await swipeRight(user.id, jobs[0].id).catch(() => null);
    check("swiping the same job twice is refused cleanly", !!again && !again.ok && (again.reason === "already_swiped" || again.reason === "blocked"));
    // Free some room by cancelling five.
    for (const app of queued.slice(0, 5)) await cancelApplication(app.id, user.id);
    if (queueFirst) {
      const refusedIds = results.map((r, i) => (!r.ok ? jobs[i].id : null)).filter((id): id is string => !!id);
      const retry = await Promise.all(refusedIds.slice(0, 5).map((id) => swipeRight(user.id, id, hold)));
      check("after some finish, the refused jobs can be swiped again", retry.filter((r) => r.ok).length === 5, `${retry.filter((r) => r.ok).length}/5`);
    } else {
      const next = await swipeRight(user.id, spare.id, hold);
      check("cancelling does not give back today's allowance", !next.ok && next.reason === "blocked" && next.rule === rule, JSON.stringify(next));
    }
  } finally {
    const apps = await db.application.findMany({ where: { userId: user.id }, select: { id: true } });
    for (const app of apps) await cancelApplication(app.id, user.id).catch(() => undefined);
    await db.job.deleteMany({ where: { companyId: { in: companies.map((c) => c.id) } } });
    await db.company.deleteMany({ where: { id: { in: companies.map((c) => c.id) } } });
    await deleteAccount(user.id).catch(() => undefined);
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS swipe-batch" : `FAIL swipe-batch (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
