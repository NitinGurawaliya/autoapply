// Jobs swiped left: never back in the feed, offered again in the "jobs you skipped" view, and one can still be applied
// to from there (the left swipe becomes the right swipe; one application). A throwaway test user and mock jobs, all
// removed. Run: npx tsx scripts/skipped-test.ts
import { db } from "../src/lib/db";
import { forgetFeed } from "../src/lib/feed-cache";
import { deleteAccount } from "../src/modules/account";
import { cancelApplication, swipeRight } from "../src/modules/apply/lifecycle";
import { listFeed, parseFeedFilters } from "../src/modules/jobs";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` (${detail})` : ""}`);
}
const stamp = Date.now();
// The application stays queued: no worker takes it.
const hold = async () => "held";

async function main() {
  const user = await db.user.create({ data: { email: `skipped-${stamp}@swipeapply.local`, name: "Skipped" } });
  await db.profile.create({ data: { userId: user.id, isTest: true, resumeKey: "x", resumeText: "x", fullName: "Skipped", email: user.email, currentTitle: "Frontend Engineer", yearsExperience: 1, skills: ["React"], tracks: ["frontend"], experience: [], education: [], rawJson: {} } });
  const company = await db.company.create({ data: { source: "mock", slug: `skipped-${stamp}`, name: `Skipped Co ${stamp}`, active: false } });
  const jobs = await Promise.all(
    [0, 1, 2].map((i) =>
      db.job.create({ data: { source: "mock", externalId: `skipped-${i}-${stamp}`, companyId: company.id, title: `Frontend Engineer ${i + 1}`, track: "frontend", location: "Bengaluru, India", country: "IN", remoteType: "unknown", description: "React. 0-2 years of experience.", applyUrl: "http://localhost:3000/mock/greenhouse", postedAt: new Date(), fetchedAt: new Date(), raw: {} } }),
    ),
  );
  const filters = parseFeedFilters({});
  const ids = (list: Array<{ id: string }>) => new Set(list.map((job) => job.id).filter((id) => jobs.some((job) => job.id === id)));
  try {
    const before = ids(await listFeed(user.id, filters));
    check("all three mock jobs are in the feed to start with", before.size === 3, `${before.size}`);

    // Skip the first one, as the deck does.
    await db.swipe.create({ data: { userId: user.id, jobId: jobs[0].id, direction: "left" } });
    forgetFeed(user.id);
    const feed = ids(await listFeed(user.id, filters));
    const skipped = ids(await listFeed(user.id, filters, "skipped"));
    check("a skipped job is not in the feed", !feed.has(jobs[0].id) && feed.size === 2, [...feed].join(","));
    check("the skipped view has the skipped job and nothing else", skipped.has(jobs[0].id) && skipped.size === 1, [...skipped].join(","));

    // Apply to it from the skipped view.
    const applied = await swipeRight(user.id, jobs[0].id, hold);
    check("a skipped job can be applied to", applied.ok, JSON.stringify(applied));
    const swipe = await db.swipe.findUnique({ where: { userId_jobId: { userId: user.id, jobId: jobs[0].id } } });
    check("its left swipe became the right swipe", swipe?.direction === "right");
    check("exactly one application was made", (await db.application.count({ where: { userId: user.id, jobId: jobs[0].id } })) === 1);
    forgetFeed(user.id);
    const after = ids(await listFeed(user.id, filters, "skipped"));
    const feedAfter = ids(await listFeed(user.id, filters));
    check("once applied, it is in neither the feed nor the skipped view", !after.has(jobs[0].id) && !feedAfter.has(jobs[0].id));
    const twice = await swipeRight(user.id, jobs[0].id, hold);
    check("applying to it a second time is refused", !twice.ok && twice.reason === "already_swiped", JSON.stringify(twice));
    const fresh = await swipeRight(user.id, jobs[1].id, hold);
    check("a job never swiped is still applied to as before", fresh.ok, JSON.stringify(fresh));
  } finally {
    for (const app of await db.application.findMany({ where: { userId: user.id }, select: { id: true } })) await cancelApplication(app.id, user.id).catch(() => undefined);
    await db.job.deleteMany({ where: { companyId: company.id } });
    await db.company.delete({ where: { id: company.id } });
    await deleteAccount(user.id).catch(() => undefined);
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS skipped" : `FAIL skipped (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
