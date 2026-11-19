// The daily set (Phase P, P7, modules/jobs/daily.ts): built once per user per India day, released four at a time by
// compare-and-set, swipes read from the Swipe table, rebuilt when the fields change, no short or degraded sets, one push
// a day. Throwaway test users and mock jobs, all removed. Run: npx tsx scripts/daily-set-test.ts
process.env.DAILY_SET = "1";
process.env.DAILY_PUSH_HOUR_IST = "1"; // the push step runs from 01:00 IST in this test (1 is the lowest it takes)
import { db } from "../src/lib/db";
import { dropFromFeed, forgetFeed } from "../src/lib/feed-cache";
import { deleteAccount } from "../src/modules/account";
import { dailyView, ensureDailySet, isDefaultFeed, listFeed, parseFeedFilters, releaseMore } from "../src/modules/jobs";
import { pushDailySets } from "../src/modules/jobs/daily";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` (${detail})` : ""}`);
}
const stamp = Date.now();
const MOCK_JOBS = 30;
const ids = (list: Array<{ id: string }> | undefined) => JSON.stringify((list ?? []).map((job) => job.id));

async function main() {
  const user = await db.user.create({ data: { email: `daily-${stamp}@swipeapply.local`, name: "Daily" } });
  const other = await db.user.create({ data: { email: `daily-b-${stamp}@swipeapply.local`, name: "Daily B" } });
  for (const u of [user, other]) {
    await db.profile.create({ data: { userId: u.id, isTest: true, resumeKey: "x", resumeText: "x", fullName: "Daily", email: u.email, currentTitle: "Frontend Engineer", yearsExperience: 1, skills: ["React"], tracks: ["frontend"], experience: [], education: [], rawJson: {} } });
  }
  const company = await db.company.create({ data: { source: "mock", slug: `daily-${stamp}`, name: `Daily Co ${stamp}`, active: false } });
  await Promise.all(
    Array.from({ length: MOCK_JOBS }, (_, i) =>
      db.job.create({ data: { source: "mock", externalId: `daily-${i}-${stamp}`, companyId: company.id, title: `Frontend Engineer ${i + 1}`, track: "frontend", location: "Bengaluru, India", country: "IN", remoteType: "unknown", description: "React. 0-1 years of experience.", applyUrl: "http://localhost:3000/mock/greenhouse", postedAt: new Date(), fetchedAt: new Date(), raw: {} } }),
    ),
  );
  const swipe = async (jobId: string, direction = "left") => {
    await db.swipe.create({ data: { userId: user.id, jobId, direction } });
    dropFromFeed(user.id, jobId);
  };
  try {
    // A new user gets a set on the first request; two requests at once share one row.
    const started = Date.now();
    const [a, b] = await Promise.all([ensureDailySet(user.id), ensureDailySet(user.id)]);
    const rows = await db.dailySet.findMany({ where: { userId: user.id } });
    console.log(`     first build ${Date.now() - started} ms, day ${a?.day}`);
    check("a new user gets a set of 12 on the first request", a?.jobIds.length === 12 && rows.length === 1, `${a?.jobIds.length} ${rows.length}`);
    check("two requests at once get the same set", JSON.stringify(a?.jobIds) === JSON.stringify(b?.jobIds));
    const set = a!.jobIds;
    const ranked = (await listFeed(user.id, parseFeedFilters({}))).map((job) => job.id);
    check("the set is the top 12 of the ranked feed, in order", JSON.stringify(set) === JSON.stringify(ranked.slice(0, 12)));

    let view = await dailyView(user.id);
    check("the first release is 4 of 12", view?.jobs.length === 4 && view.released === 4 && view.total === 12 && view.more && view.next === 4, JSON.stringify({ n: view?.jobs.length, r: view?.released, m: view?.more }));
    check("the release is the set's first four, in order", ids(view?.jobs) === JSON.stringify(set.slice(0, 4)));

    // Swipes are read from the Swipe table: a swipe this process's cache never saw (another process) still counts.
    await db.swipe.create({ data: { userId: user.id, jobId: set[0], direction: "left" } });
    view = await dailyView(user.id);
    check("a swipe saved elsewhere takes its card out (Swipe table, not the cache)", view?.jobs.length === 3 && !view.jobs.some((job) => job.id === set[0]));
    for (const id of set.slice(1, 4)) await swipe(id, "right");
    view = await dailyView(user.id);
    check("after the batch: no card, '4 more' offered", view?.jobs.length === 0 && view.more && view.next === 4);

    // "4 more" by compare-and-set: a second tab asking from the same point gets the current release, no skip.
    const first = await releaseMore(user.id, 4);
    const second = await releaseMore(user.id, 4);
    check("'4 more' advances the release to 8", first.advanced && first.view?.released === 8 && first.view.jobs.length === 4);
    check("a second tab's '4 more' from 4 is refused and shows the same batch", !second.advanced && second.view?.released === 8 && ids(second.view.jobs) === JSON.stringify(set.slice(4, 8)));
    view = await dailyView(user.id);
    check("a refresh shows the same batch (released stays 8)", view?.released === 8 && ids(view.jobs) === JSON.stringify(set.slice(4, 8)));
    for (const id of set.slice(4, 8)) await swipe(id);

    // One job of the last batch was skipped from its own page: the last batch has three.
    await swipe(set[9]);
    view = (await releaseMore(user.id, 8)).view;
    check("fewer than four at the end are shown (3)", view?.jobs.length === 3 && view.released === 12 && !view.more, JSON.stringify({ n: view?.jobs.length, r: view?.released, m: view?.more }));
    check("releasing past the end is refused", !(await releaseMore(user.id, 12)).advanced);
    for (const job of view!.jobs) await swipe(job.id);
    view = await dailyView(user.id);
    check("then the end state (no card, nothing more)", view?.jobs.length === 0 && !view.more && view.released === 12);
    // The first swipe went straight to the table (another process); this process's minute-long cache still lists it.
    forgetFeed(user.id);
    const remainder = await listFeed(user.id, parseFeedFilters({}));
    check("the ranked remainder follows, without the set's jobs", remainder.length >= MOCK_JOBS - 12 && !remainder.some((job) => set.includes(job.id)), `${remainder.length}`);
    console.log(`     remainder after the set: ${remainder.length} cards`);

    // Changing fields rebuilds the set: a new 12, released from 4 again, none of today's swiped jobs.
    await db.profile.update({ where: { userId: user.id }, data: { showNearby: true } });
    forgetFeed(user.id);
    const rebuilt = await ensureDailySet(user.id);
    check("changing fields rebuilds the set", rebuilt != null && rebuilt.basis !== a!.basis && rebuilt.released === 4 && rebuilt.jobIds.length === 12 && !rebuilt.jobIds.some((id) => set.includes(id)));
    check("still one row for the day", (await db.dailySet.count({ where: { userId: user.id } })) === 1);

    // Only the default view is the set.
    check("a filter is not the default view", !isDefaultFeed(parseFeedFilters({ level: "fresher" })) && !isDefaultFeed(parseFeedFilters({ track: "frontend" })) && isDefaultFeed(parseFeedFilters({})));

    // No degraded and no short sets.
    const otherFeed = await listFeed(other.id, parseFeedFilters({}));
    check("a degraded feed builds no set", (await ensureDailySet(other.id, { jobs: otherFeed, degraded: true })) === null && (await db.dailySet.count({ where: { userId: other.id } })) === 0);
    check("a short feed (11 jobs) builds no set", (await ensureDailySet(other.id, { jobs: otherFeed.slice(0, 11), degraded: false })) === null && (await db.dailySet.count({ where: { userId: other.id } })) === 0);

    // One push per user per day: the second call finds pushedAt already claimed.
    await db.pushSubscription.create({ data: { userId: user.id, endpoint: `https://push.invalid/daily-${stamp}`, p256dh: "x", auth: "x" } });
    const push1 = await pushDailySets(Date.now() + 60_000, [user.id]);
    const push2 = await pushDailySets(Date.now() + 60_000, [user.id]);
    const pushedAt = (await db.dailySet.findFirst({ where: { userId: user.id } }))?.pushedAt;
    // The push hour is at least 01:00 IST (DAILY_PUSH_HOUR_IST takes 1 or more), so between 00:00 and 01:00 IST nothing
    // may be pushed yet: the check is then that none is (it failed at 00:15 IST on 20 Nov while the code was right).
    const [{ hour }] = await db.$queryRaw<Array<{ hour: number }>>`SELECT extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')::int AS hour`;
    if (hour < 1) check("no set push before the push hour (00:00-01:00 IST)", push1.pushed === 0 && push2.pushed === 0 && pushedAt == null, `${push1.pushed} ${push2.pushed}`);
    else check("one set push per user per day", push1.pushed === 1 && push2.pushed === 0 && pushedAt != null, `${push1.pushed} ${push2.pushed}`);
  } finally {
    await db.job.deleteMany({ where: { companyId: company.id } });
    await db.company.delete({ where: { id: company.id } });
    await deleteAccount(user.id).catch(() => undefined);
    await deleteAccount(other.id).catch(() => undefined);
    const left = await db.dailySet.count({ where: { userId: { in: [user.id, other.id] } } });
    check("cleanup: the test users' sets went with them (cascade)", left === 0);
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS daily-set" : `FAIL daily-set (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
