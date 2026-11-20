// The daily reveal's data (Phase R, docs/reveal/TDD.md 4.3; modules/jobs/daily.ts): the whole set released at once by
// default, the reveal full for a user's first 3 days and after 4 days away and short otherwise, none when fewer than 2 of
// the set's jobs are open or the set has no stats, and gone once seen. A throwaway user and mock jobs, all removed.
// Run: npx tsx scripts/daily-reveal-test.ts
process.env.DAILY_SET = "1";
delete process.env.DAILY_RELEASE;
import { db } from "../src/lib/db";
import { dropFromFeed, forgetFeed } from "../src/lib/feed-cache";
import { deleteAccount } from "../src/modules/account";
import { dailyView, ensureDailySet, markRevealed } from "../src/modules/jobs";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` (${detail})` : ""}`);
}
const stamp = Date.now();

// A past day's set for this user, revealed or not, `daysAgo` India days back.
async function pastDay(userId: string, daysAgo: number, revealed: boolean) {
  await db.$executeRaw`
    INSERT INTO "DailySet" ("userId", "day", "jobIds", released, basis, "revealedAt")
    VALUES (${userId}, (now() AT TIME ZONE 'Asia/Kolkata')::date - ${daysAgo}::int, ARRAY[]::text[], 12, 'past', ${revealed ? new Date() : null})`;
}
const today = (userId: string) => db.$executeRaw`DELETE FROM "DailySet" WHERE "userId" = ${userId} AND "day" = (now() AT TIME ZONE 'Asia/Kolkata')::date`;

async function main() {
  const user = await db.user.create({ data: { email: `reveal-${stamp}@swipeapply.local`, name: "Reveal" } });
  await db.profile.create({ data: { userId: user.id, isTest: true, resumeKey: "x", resumeText: "x", fullName: "Reveal", email: user.email, currentTitle: "Frontend Engineer", yearsExperience: 1, skills: ["React"], tracks: ["frontend"], experience: [], education: [], rawJson: {} } });
  const company = await db.company.create({ data: { source: "mock", slug: `reveal-${stamp}`, name: `Reveal Co ${stamp}`, active: false } });
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      db.job.create({ data: { source: "mock", externalId: `reveal-${i}-${stamp}`, companyId: company.id, title: `Frontend Engineer ${i + 1}`, track: "frontend", location: "Bengaluru, India", country: "IN", remoteType: "unknown", description: "React. 0-1 years of experience.", applyUrl: "http://localhost:3000/mock/greenhouse", postedAt: new Date(), fetchedAt: new Date(), raw: {} } }),
    ),
  );
  const fresh = async () => {
    await today(user.id);
    forgetFeed(user.id);
    await ensureDailySet(user.id);
    return dailyView(user.id);
  };
  try {
    let view = await fresh();
    check("the whole set is released at once by default (no sets of four)", view?.jobs.length === 12 && view.released === 12 && !view.more, JSON.stringify({ n: view?.jobs.length, r: view?.released }));
    check("first day: the full reveal", view?.reveal?.full === true);

    // Three days already seen, the last yesterday: the short one.
    for (const d of [1, 2, 3]) await pastDay(user.id, d, true);
    view = await fresh();
    check("after 3 days seen, yesterday the last: the short reveal", view?.reveal?.full === false);

    // Back after 5 days away: the full one again.
    await db.$executeRaw`DELETE FROM "DailySet" WHERE "userId" = ${user.id} AND basis = 'past'`;
    for (const d of [6, 7, 8]) await pastDay(user.id, d, true);
    view = await fresh();
    check("after 5 days away: the full reveal again", view?.reveal?.full === true);

    // Days built but never seen do not count towards the short one.
    await db.$executeRaw`DELETE FROM "DailySet" WHERE "userId" = ${user.id} AND basis = 'past'`;
    for (const d of [1, 2, 3]) await pastDay(user.id, d, false);
    view = await fresh();
    check("days never seen do not count: still the full reveal", view?.reveal?.full === true);

    // Seen today: gone, on any later load.
    check("marked seen", await markRevealed(user.id));
    check("seen: no reveal on the next load", (await dailyView(user.id))?.reveal === null);
    check("marking twice keeps the first time", await markRevealed(user.id));

    // Fewer than 2 open jobs left in the set: straight to the cards.
    await today(user.id);
    forgetFeed(user.id);
    const set = await ensureDailySet(user.id);
    for (const id of set!.jobIds.slice(0, 11)) {
      await db.swipe.create({ data: { userId: user.id, jobId: id, direction: "left" } });
      dropFromFeed(user.id, id);
    }
    check("one open job left: no reveal", (await dailyView(user.id))?.reveal === null);

    // A set from before Phase R has no stats: no reveal that day.
    await db.swipe.deleteMany({ where: { userId: user.id } });
    forgetFeed(user.id);
    await db.$executeRaw`UPDATE "DailySet" SET stats = NULL, "revealedAt" = NULL WHERE "userId" = ${user.id}`;
    check("a set without stats: no reveal", (await dailyView(user.id))?.reveal === null);
    check("no set: nothing to mark", await (async () => { await today(user.id); return !(await markRevealed(user.id)); })());
  } finally {
    await db.swipe.deleteMany({ where: { userId: user.id } });
    await db.job.deleteMany({ where: { companyId: company.id } });
    await db.company.delete({ where: { id: company.id } });
    await deleteAccount(user.id).catch(() => undefined);
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS daily-reveal" : `FAIL daily-reveal (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
