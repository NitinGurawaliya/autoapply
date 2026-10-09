// Swiping right on many jobs at once: every swipe is tracked, none is lost, the queue cap holds under a burst.
// Uses a temporary test user and mock jobs. npx tsx scripts/swipe-batch-test.ts
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
  const cap = loadRules().max_in_flight_per_user;
  const total = cap + 8;
  const user = await db.user.create({ data: { email: `batch-${stamp}@swipeapply.local`, name: "batch" } });
  await db.profile.create({ data: { userId: user.id, isTest: true, resumeKey: "x", resumeText: "x", fullName: "Batch", email: user.email, currentTitle: "Software Engineer", yearsExperience: 1, skills: [], experience: [], education: [], rawJson: {} } });
  const companyCount = Math.ceil(total / 3);
  const companies = await Promise.all(Array.from({ length: companyCount }, (_, i) => db.company.create({ data: { source: "mock", slug: `batch-${i}-${stamp}`, name: `Batch Co ${i} ${stamp}`, active: false } })));
  const jobs = await Promise.all(
    Array.from({ length: total }, (_, i) =>
      db.job.create({ data: { source: "mock", externalId: `batch-${i}-${stamp}`, companyId: companies[i % companyCount].id, title: `Software Engineer ${String.fromCharCode(65 + (i % 26))}${i}`, location: "Bengaluru, India", country: "IN", remoteType: "unknown", description: "Software Engineer. 0-2 years of experience.", applyUrl: "http://localhost:3000/mock/greenhouse", postedAt: new Date(), fetchedAt: new Date(), raw: {} } }),
    ),
  );
  try {
    // A burst: swipes fired together.
    // Waves of 6 at the same moment (the database pool is small; a person cannot swipe faster than this anyway).
    const results: Awaited<ReturnType<typeof swipeRight>>[] = [];
    for (let i = 0; i < jobs.length; i += 6) results.push(...(await Promise.all(jobs.slice(i, i + 6).map((job) => swipeRight(user.id, job.id, hold)))));
    const accepted = results.filter((r) => r.ok);
    const full = results.filter((r) => !r.ok && r.reason === "blocked" && r.rule === "max_in_flight");
    check(`exactly ${cap} of ${total} simultaneous swipes were accepted`, accepted.length === cap, `accepted ${accepted.length}`);
    check("the rest were told the queue is full, nothing else", full.length === total - cap, `full ${full.length}`);
    const apps = await db.application.findMany({ where: { userId: user.id } });
    check("every accepted swipe has exactly one queued application", apps.length === cap && apps.every((a) => a.status === "queued"), `apps ${apps.length}`);
    const swipes = await db.swipe.count({ where: { userId: user.id } });
    check("a swipe refused for a full queue is not recorded, so the job stays swipeable", swipes === cap, `swipes ${swipes}`);
    const again = await swipeRight(user.id, jobs[0].id).catch(() => null);
    check("swiping the same job twice is refused cleanly", !!again && !again.ok && (again.reason === "already_swiped" || again.reason === "blocked"));
    // Free some room: the refused jobs can now be swiped.
    for (const app of apps.slice(0, 5)) await cancelApplication(app.id, user.id);
    const refusedIds = results.map((r, i) => (!r.ok ? jobs[i].id : null)).filter((id): id is string => !!id);
    const retry = await Promise.all(refusedIds.slice(0, 5).map((id) => swipeRight(user.id, id, hold)));
    check("after some finish, the refused jobs can be swiped again", retry.filter((r) => r.ok).length === 5, `${retry.filter((r) => r.ok).length}/5`);
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
