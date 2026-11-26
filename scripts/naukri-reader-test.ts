// K14 (docs/naukri/TASKS.md#k14): the shared Naukri reader, offline.
//
// npx tsx scripts/naukri-reader-test.ts
//   No Naukri, no proxy, no browser: the search buckets (planner, matching, cadence), then, with the migration
//   20261127090000_reader_buckets applied, the reader's rows and its window against a fake page that answers with the
//   recorded Naukri listings: plan from connected users, atomic claim, a window's reads and storing, the incremental
//   stop, a company's bucket keeping only its own jobs, a check ending the window and pausing the reader, the daily page
//   budget. Own site name ("naukri-smoke"), users, jobs, companies and rows; all removed at the end.
//
// Live windows (real Naukri, signed out, the reader's own proxy address; needs a worker with a screen, the screen image):
//   npx tsx scripts/naukri-reader-test.ts --live <user id suffix>
//   One window on company buckets (load them first: scripts/naukri-company-buckets.ts --write) and one on the search
//   buckets of that connected user; pages and job pages kept small. Prints each run and what was stored.
process.env.INGEST_DAYS = "3650"; // the recorded listings are old by the time this runs again

import { readFileSync } from "node:fs";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const SITE = "naukri-smoke";

async function pure() {
  const b = await import("../src/modules/jobs/fetchers/naukriBuckets");
  const { readerRules } = await import("../src/modules/governance");
  check("years go to the nearest band", [0, 1, 2, 4, 5, 8, 15].map((n) => b.bandOf(n)).join(",") === "1,1,1,3,6,6,10", [0, 1, 2, 4, 5, 8, 15].map((n) => b.bandOf(n)).join(","));
  check("unknown years stay unknown", b.bandOf(null) === null);
  check("a bucket is the same however it is spelled", b.bucketKey({ keyword: "Backend  Developer", location: "Bengaluru", experience: 3 }) === b.bucketKey({ keyword: "backend-developer", location: "bengaluru", experience: 3 }));
  const mine = b.bucketsOf({ tracks: ["backend", "fullstack"], currentTitle: "Java Developer", city: "Pune", yearsExperience: 2 }, 6);
  check("a user's buckets: field first, their city then the shared places, no duplicate, within the limit", mine.length === 6 && new Set(mine.map((x) => x.key)).size === 6 && mine[0].keyword === "backend developer" && mine[0].location?.toLowerCase() === "pune" && mine.every((x) => x.experience === 1), mine.map((x) => x.key).join(" ; "));
  const planned = b.planBuckets(
    [
      { tracks: ["backend"], currentTitle: null, city: "Pune", yearsExperience: 2 },
      { tracks: ["backend"], currentTitle: null, city: "Pune", yearsExperience: 1 },
      { tracks: ["qa"], currentTitle: null, city: "Chennai", yearsExperience: 7 },
    ],
    { perUser: 5, max: 4 },
  );
  check("users that search alike share one bucket, the most wanted first", planned.length === 4 && planned.every((x) => x.users === 2 && x.key.startsWith("backend-developer|")), planned.map((x) => `${x.key}:${x.users}`).join(" ; "));
  const alike = (n: number) => b.planBuckets(Array.from({ length: n }, () => ({ tracks: ["backend"], currentTitle: null, city: "Pune", yearsExperience: 2 })), { perUser: 5, max: 400 });
  check("cost follows buckets, not users: 500 alike users plan what one does", alike(500).length === alike(1).length && alike(500)[0].users === 500, `${alike(1).length} vs ${alike(500).length}`);
  const tiers = [{ users: 20, hours: 6 }, { users: 5, hours: 12 }, { users: 1, hours: 24 }];
  check("busier buckets are read more often", [30, 20, 7, 5, 1].map((n) => b.everyHours(n, tiers)).join(",") === "6,6,12,12,24");
  const now = new Date("2026-11-27T12:00:00Z");
  check("a search never read asks a week, one read lately the newest few days", b.jobAgeFor(null, now) === 7 && b.jobAgeFor(new Date("2026-11-26T12:00:00Z"), now) === 3 && b.jobAgeFor(new Date("2026-11-20T12:00:00Z"), now) === 7);
  check("a company never read asks a month, one read this week the last week", b.jobAgeFor(null, now, "company") === 30 && b.jobAgeFor(new Date("2026-11-24T12:00:00Z"), now, "company") === 7 && b.jobAgeFor(new Date("2026-11-01T12:00:00Z"), now, "company") === 30);
  const kotak = b.companyBucket("Kotak Mahindra Bank Ltd..");
  check("a company's bucket is its cleaned name", kotak?.key === "co|kotak-mahindra-bank-ltd" && kotak.keyword === "Kotak Mahindra Bank Ltd" && kotak.location === null && b.companyBucket("A") === null, JSON.stringify(kotak));
  const pairs: Array<[string, string, boolean]> = [
    ["Kotak Mahindra Bank Ltd..", "Kotak Mahindra Bank", true],
    ["Jones Lang Lasalle", "Jones Lang LaSalle (JLL)", true],
    ["Fedex", "FedEx", true],
    ["JW Marriott", "Marriott", true],
    ["DLF", "DLF Ltd", true],
    ["Bajaj Finance", "Hdfc Bank", false],
    ["EY", "Keynote Systems", false],
  ];
  check("Naukri's spelling of a company still matches, another company never does", pairs.every(([a, c, want]) => b.matchesCompany(a, c) === want), pairs.map(([a, c]) => `${a}~${c}:${b.matchesCompany(a, c)}`).join(" "));
  const rules = readerRules("naukri");
  check("the rules file has the reader's pace and caps", !!rules && rules.buckets_per_run >= 1 && rules.pause_hours_after_challenge >= 1 && rules.every_hours.length >= 1, JSON.stringify(rules)?.slice(0, 120));
}

async function database() {
  const { db } = await import("../src/lib/db");
  const rules0 = (await import("../src/modules/governance")).readerRules("naukri");
  if (!rules0) throw new Error("no reader rules");
  try {
    await db.readerBucket.count();
  } catch {
    console.log("skip the database part: migration 20261127090000_reader_buckets is not applied here");
    return;
  }
  const reader = await import("../src/modules/sources/reader");
  const { runReader } = await import("../src/modules/apply/sites/reader");
  const search = JSON.parse(readFileSync("tests/fixtures/naukri/search.json", "utf8"));
  const stamp = Date.now();
  const users: string[] = [];
  const rules = { ...rules0, buckets_per_run: 8, pages_per_bucket: 2, details_per_bucket: 0, max_pages_per_day: 1000, max_details_per_day: 0 };
  const base = new Date();
  const person = async (label: string, tracks: string[], city: string, years: number, status = "connected") => {
    const user = await db.user.create({ data: { email: `naukri-reader-${label}-${stamp}@swipeapply.local` } });
    users.push(user.id);
    await db.profile.create({
      data: { userId: user.id, isTest: false, resumeKey: "x", resumeText: "Developer", fullName: `Reader ${label}`, email: user.email, city, country: "India", yearsExperience: years, currentTitle: null, tracks, skills: ["Java"], experience: [], education: [], rawJson: {} },
    });
    await db.siteConnection.create({ data: { userId: user.id, site: SITE, status, consentAt: new Date(), stateKey: `browser-state/${user.id}/naukri.json` } });
    return user.id;
  };
  try {
    // 1. Planning from the connected users only.
    const a = await person("a", ["backend"], "Pune", 2);
    const b = await person("b", ["backend"], "Pune", 1);
    const c = await person("c", ["qa"], "Chennai", 7);
    const gone = await person("gone", ["devops"], "Delhi", 5, "disconnected");
    const only = { userIds: [a, b, c, gone] };
    const plan = await reader.planReaderBuckets(SITE, { ...rules, buckets_per_user: 3 }, base, only);
    const rows = await db.readerBucket.findMany({ where: { site: SITE }, orderBy: [{ users: "desc" }, { key: "asc" }] });
    check("the plan covers the connected users' searches", plan.users === 3 && rows.length === plan.buckets && rows.length === plan.added, JSON.stringify(plan));
    check("a bucket two users share carries both, and a user who disconnected adds none", rows[0].users === 2 && !rows.some((row) => row.keyword.includes("devops")), rows.map((row) => `${row.key}:${row.users}`).join(" ; "));
    check("a new bucket is due at once and kept fresher the more users it serves", rows.every((row) => row.nextReadAt <= base && row.kind === "search") && rows[0].everyHours === 24, `${rows[0].everyHours}h`);
    const again = await reader.planReaderBuckets(SITE, { ...rules, buckets_per_user: 3 }, base, only);
    check("planning again changes nothing", again.added === 0 && again.retired === 0, JSON.stringify(again));
    const fewer = await reader.planReaderBuckets(SITE, { ...rules, buckets_per_user: 3 }, base, { userIds: [a] });
    check("a bucket no connected user wants is switched off", fewer.retired > 0 && (await db.readerBucket.count({ where: { site: SITE, active: true } })) === fewer.buckets, JSON.stringify(fewer));
    await reader.planReaderBuckets(SITE, { ...rules, buckets_per_user: 3 }, base, only);

    // 2. Claiming is atomic.
    const first = await reader.claimBuckets(SITE, 2, 30, base);
    const second = await reader.claimBuckets(SITE, 20, 30, base);
    check("two windows never hold one bucket", first.length === 2 && first[0].users >= first[1].users && second.every((row) => !first.some((held) => held.id === row.id)) && first.length + second.length === (await db.readerBucket.count({ where: { site: SITE, active: true } })), `${first.length} + ${second.length}`);
    await reader.releaseBuckets([...first, ...second].map((row) => row.id), null);
    check("a released bucket is due again", (await reader.dueBuckets(SITE, base)) === (await db.readerBucket.count({ where: { site: SITE, active: true } })));

    // 3. A window against a fake page.
    const urls: string[] = [];
    const owners: string[] = [];
    let answer: () => unknown = () => search;
    const fake = (clock: () => Date, errorStop?: "challenge" | "error", errorDetail = "Naukri asked for a check") => ({
      open: async (_site: string, owner: string) => {
        owners.push(owner);
        return {
          search: async (url: string) => {
            urls.push(url);
            return errorStop ? { ok: false as const, stop: errorStop, detail: errorDetail } : { ok: true as const, json: answer() };
          },
          job: async () => ({ ok: false as const, stop: "error" as const, detail: "no job pages here" }),
          close: async () => undefined,
        };
      },
      pause: async () => undefined,
      now: clock,
      log: () => undefined,
      embed: async () => 0,
    });
    // Only one bucket due for the window: the others are pushed out.
    await db.readerBucket.updateMany({ where: { site: SITE }, data: { nextReadAt: new Date(base.getTime() + 86_400_000) } });
    const target = rows.find((row) => row.users === 2)!;
    await db.readerBucket.update({ where: { id: target.id }, data: { nextReadAt: base, lastReadAt: null } });
    const run1 = await runReader(SITE, { rules, deps: fake(() => base) });
    check("a window reads the due bucket, stores its listings and records the run", run1.status === "ran" && run1.stopReason === "done" && run1.buckets === 1 && run1.pages === 1 && run1.listed === 3, JSON.stringify(run1));
    const stored = await db.job.count({ where: { source: SITE } });
    check("the jobs are ordinary Job rows under companies of their own", stored >= 1 && (await db.company.count({ where: { source: SITE } })) >= 1, `${stored} jobs`);
    const after = await db.readerBucket.findUnique({ where: { id: target.id } });
    check("the bucket is read, not claimed, and due again after its cadence", !!after?.lastReadAt && after.claimedUntil === null && after.nextReadAt.getTime() > base.getTime() + 20 * 3_600_000 && after.lastStop === "done" && after.lastListed === 3, JSON.stringify({ next: after?.nextReadAt, stop: after?.lastStop }));
    check("a never-read search asks a week of postings", urls[0].includes("jobAge=7") && urls[0].includes(`-jobs-in-${target.location?.toLowerCase()}`), urls[0]);
    const runRow = await db.readerRun.findUnique({ where: { id: (run1 as { runId: string }).runId } });
    check("the run record keeps counts only", runRow?.site === SITE && runRow.pages === 1 && runRow.finishedAt !== null && runRow.reader === "reader-1-0", JSON.stringify(runRow));

    // 4. The incremental stop: a second read finds a full page it already has and does not go deeper.
    const full = structuredClone(search);
    full.noOfJobs = 100;
    full.jobDetails = Array.from({ length: 20 }, (_, i) => ({ ...structuredClone(search.jobDetails[0]), jobId: `${stamp}${100 + i}`, companyId: 900000 + i, groupId: 900000 + i, companyName: `Smoke Company ${i}`, title: `Backend Developer ${i}` }));
    answer = () => full;
    await db.readerBucket.update({ where: { id: target.id }, data: { nextReadAt: base, lastReadAt: new Date(base.getTime() - 3_600_000) } });
    urls.length = 0;
    const run2 = await runReader(SITE, { rules, deps: fake(() => new Date(base.getTime() + 60_000)) });
    check("a full page of new jobs goes one page deeper", run2.status === "ran" && run2.pages === 2 && run2.listed === 40, JSON.stringify(run2));
    check("a bucket read an hour ago asks only the newest days", urls[0].includes("jobAge=3"), urls[0]);
    await db.readerBucket.update({ where: { id: target.id }, data: { nextReadAt: base } });
    urls.length = 0;
    const run3 = await runReader(SITE, { rules, deps: fake(() => new Date(base.getTime() + 120_000)) });
    check("a page it already has ends the bucket there, however many pages remain", run3.status === "ran" && run3.pages === 1 && urls.length === 1, JSON.stringify(run3));

    // 4b. A search Naukri answers with a client error is an empty search, not a failure: the bucket waits its cadence.
    await db.readerBucket.update({ where: { id: target.id }, data: { nextReadAt: base, failures: 0 } });
    const empty = await runReader(SITE, { rules, deps: fake(() => new Date(base.getTime() + 150_000), "error", "Naukri answered 400") });
    const emptied = await db.readerBucket.findUnique({ where: { id: target.id } });
    check("a 400 on a search is an empty search: read, not failed, due after its cadence", empty.status === "ran" && empty.stopReason === "done" && emptied?.failures === 0 && emptied.lastStop === "done" && emptied.lastListed === 0 && emptied.nextReadAt.getTime() > base.getTime() + 20 * 3_600_000, JSON.stringify({ empty, stop: emptied?.lastStop, failures: emptied?.failures }));
    const broken = await runReader(SITE, { rules, deps: fake(() => new Date(base.getTime() + 160_000), "error", "Naukri answered 500") }).catch(() => null);
    check("another error with nothing due changes nothing", broken?.status === "skipped" && broken.reason === "nothing_due", JSON.stringify(broken));

    // 5. The daily budget.
    const spent = (await reader.readerState(SITE, rules, base)).pagesToday;
    await db.readerBucket.update({ where: { id: target.id }, data: { nextReadAt: base } });
    const capped = await runReader(SITE, { rules: { ...rules, max_pages_per_day: spent }, deps: fake(() => base) });
    check("the day's page budget stops the reader before it opens a window", capped.status === "skipped" && capped.reason === "daily_budget", JSON.stringify(capped));

    // 6. A company's bucket keeps only that company's jobs; a name Naukri has none for waits two weeks.
    const seeded = await reader.seedCompanyBuckets(SITE, ["Infosys BPM", "Nobody Corp"], 96, base);
    const seededAgain = await reader.seedCompanyBuckets(SITE, ["Infosys BPM"], 96, base);
    check("a list's names become company buckets once", seeded.added === 2 && seededAgain.added === 0 && seededAgain.known === 1, JSON.stringify({ seeded, seededAgain }));
    answer = () => search;
    await db.readerBucket.updateMany({ where: { site: SITE, kind: "search" }, data: { nextReadAt: new Date(base.getTime() + 86_400_000) } });
    urls.length = 0;
    const before = await db.job.count({ where: { source: SITE } });
    const run4 = await runReader(SITE, { rules, deps: fake(() => new Date(base.getTime() + 180_000)) });
    const infosys = await db.job.findMany({ where: { source: SITE, externalId: search.jobDetails[0].jobId } });
    check("a company's search keeps only the listings of that company", run4.status === "ran" && run4.buckets === 2 && run4.listed === 1 && infosys.length === 1 && (await db.job.count({ where: { source: SITE } })) === before, JSON.stringify(run4));
    check("a company is searched by its name alone, a month back the first time", urls.some((url) => /\/infosys-bpm-jobs\?/.test(url) && url.includes("jobAge=30") && !url.includes("experience=")), urls.join(" "));
    const nobody = await db.readerBucket.findUnique({ where: { site_key: { site: SITE, key: "co|nobody-corp" } } });
    check("a name with no jobs of its own is tried again only after about two weeks (14 days, 10% either way)", nobody?.lastStop === "no_match" && nobody.nextReadAt.getTime() > base.getTime() + 12 * 86_400_000, `${nobody?.lastStop} ${nobody?.nextReadAt?.toISOString()}`);

    // 7. A check ends the window and pauses the reader; the next window comes from a new address.
    await db.readerBucket.updateMany({ where: { site: SITE }, data: { nextReadAt: base, claimedUntil: null } });
    const t0 = new Date(base.getTime() + 600_000);
    const blocked = await runReader(SITE, { rules, deps: fake(() => t0, "challenge") });
    check("a check stops the window, which gives its buckets back unread", blocked.status === "ran" && blocked.stopReason === "challenge" && blocked.buckets === 1 && (await db.readerBucket.count({ where: { site: SITE, claimedUntil: { not: null } } })) === 0, JSON.stringify(blocked));
    check("the stop is on the bucket, which stays due", (await db.readerBucket.count({ where: { site: SITE, lastStop: "challenge", nextReadAt: { lte: base } } })) >= 1);
    const paused = await runReader(SITE, { rules, deps: fake(() => new Date(t0.getTime() + 3_600_000)) });
    check("the reader stays paused after a check", paused.status === "skipped" && paused.reason === "paused", JSON.stringify(paused));
    owners.length = 0;
    answer = () => search;
    const later = new Date(t0.getTime() + (rules.pause_hours_after_challenge + 1) * 3_600_000);
    const resumed = await runReader(SITE, { rules, deps: fake(() => later) });
    check("after the pause it reads again, from a new proxy address", resumed.status === "ran" && owners[0] === "reader-1-1", `${JSON.stringify(resumed)} ${owners.join(",")}`);
  } finally {
    await db.readerBucket.deleteMany({ where: { site: SITE } });
    await db.readerRun.deleteMany({ where: { site: SITE } });
    const jobs = await db.job.findMany({ where: { source: SITE }, select: { id: true } });
    await db.swipe.deleteMany({ where: { jobId: { in: jobs.map((job) => job.id) } } }).catch(() => undefined);
    await db.jobJudgement.deleteMany({ where: { jobId: { in: jobs.map((job) => job.id) } } }).catch(() => undefined);
    await db.job.deleteMany({ where: { source: SITE } });
    await db.company.deleteMany({ where: { source: SITE } });
    await db.siteConnection.deleteMany({ where: { userId: { in: users } } });
    await db.profile.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
}

async function live(suffix: string) {
  const { db } = await import("../src/lib/db");
  const { readerRules } = await import("../src/modules/governance");
  const reader = await import("../src/modules/sources/reader");
  const { runReader } = await import("../src/modules/apply/sites/reader");
  const rules = readerRules("naukri");
  if (!rules) throw new Error("no reader rules");
  const user = (await db.user.findMany({ where: { id: { endsWith: suffix } }, select: { id: true } }))[0];
  if (!user) throw new Error("no user with that id suffix");
  const jobs0 = await db.job.count({ where: { source: "naukri" } });
  const companyBuckets = await db.readerBucket.count({ where: { site: "naukri", kind: "company", active: true } });
  check("company buckets are loaded", companyBuckets > 0, `${companyBuckets}`);
  const window1 = await runReader("naukri", { rules: { ...rules, buckets_per_run: 6, pages_per_bucket: 1, details_per_bucket: 3 } });
  check("a window on company buckets ran", window1.status === "ran" && window1.pages >= 1 && ["done", "budget"].includes(window1.stopReason), JSON.stringify(window1));
  const plan = await reader.planReaderBuckets("naukri", rules, new Date(), { userIds: [user.id] });
  console.log(`plan for the connected user: ${JSON.stringify(plan)}`);
  const window2 = await runReader("naukri", { rules: { ...rules, buckets_per_run: 3, pages_per_bucket: 2, details_per_bucket: 3 } });
  check("a window on the connected user's search buckets ran", window2.status === "ran" && window2.pages >= 1 && ["done", "budget"].includes(window2.stopReason), JSON.stringify(window2));
  const read = await db.readerBucket.findMany({ where: { site: "naukri", lastReadAt: { gte: new Date(Date.now() - 3_600_000) } }, orderBy: { lastReadAt: "asc" }, select: { kind: true, keyword: true, location: true, experience: true, lastStop: true, lastListed: true } });
  for (const row of read) console.log(`  ${row.kind} "${row.keyword}"${row.location ? ` in ${row.location}` : ""}${row.experience != null ? ` ${row.experience}y` : ""}: ${row.lastStop}, ${row.lastListed ?? 0} listed`);
  const jobs1 = await db.job.count({ where: { source: "naukri" } });
  check("Naukri jobs were stored", jobs1 > jobs0, `${jobs0} -> ${jobs1}`);
  await db.$disconnect();
}

async function main() {
  const at = process.argv.indexOf("--live");
  if (at >= 0) {
    await live(process.argv[at + 1] ?? "");
    console.log(failed === 0 ? "PASS naukri-reader-test --live" : `FAIL naukri-reader-test --live (${failed})`);
    process.exit(failed === 0 ? 0 : 1);
  }
  await pure();
  await database();
  console.log(failed === 0 ? "PASS naukri-reader-test" : `FAIL naukri-reader-test (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  console.log("FAIL naukri-reader-test (crashed)");
  process.exit(1);
});
