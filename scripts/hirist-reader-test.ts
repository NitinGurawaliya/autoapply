// K17 (docs/hirist/TASKS.md#k17): the shared reader for Hirist, offline.
//
// npx tsx scripts/hirist-reader-test.ts
//   No Hirist, no proxy, no browser: the reader's window (modules/apply/sites/reader.ts) against a fake page that answers
//   with the recorded Hirist listings (tests/fixtures/hirist/search.json). Needs migration 20261127090000_reader_buckets.
//   Own site name ("hirist-smoke", read with Hirist's driver), rows, jobs and companies; all removed at the end.
//
// Live window (real Hirist, signed out, the reader's own proxy address; needs the screen image):
//   npx tsx scripts/hirist-reader-test.ts --live
//   Seeds the company buckets of a few well-known names under site "hirist" and runs one small window.
process.env.INGEST_DAYS = "3650"; // the recorded listings are old by the time this runs again

import { readFileSync } from "node:fs";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const SITE = "hirist-smoke";

async function offline() {
  const { db } = await import("../src/lib/db");
  const { readerRules } = await import("../src/modules/governance");
  const rules0 = readerRules("hirist");
  check("the rules file has Hirist's pace, no faster than its robots.txt crawl delay", !!rules0 && rules0.seconds_between_pages >= 10 && rules0.max_pages_per_day <= 300 && rules0.pause_hours_after_challenge >= 1, JSON.stringify(rules0)?.slice(0, 110));
  if (!rules0) return;
  try {
    await db.readerBucket.count();
  } catch {
    console.log("skip the database part: migration 20261127090000_reader_buckets is not applied here");
    return;
  }
  const reader = await import("../src/modules/sources/reader");
  const { runReader } = await import("../src/modules/apply/sites/reader");
  const search = JSON.parse(readFileSync("tests/fixtures/hirist/search.json", "utf8"));
  const stamp = Date.now();
  const rules = { ...rules0, buckets_per_run: 8, pages_per_bucket: 2, details_per_bucket: 0, max_pages_per_day: 1000, max_details_per_day: 0 };
  const base = new Date();
  const urls: string[] = [];
  const owners: string[] = [];
  let answer: () => unknown = () => search;
  const fake = (clock: () => Date, errorStop?: "challenge" | "refused") => ({
    open: async (_site: string, owner: string) => {
      owners.push(owner);
      return {
        search: async (url: string) => {
          urls.push(url);
          return errorStop ? { ok: false as const, stop: errorStop, detail: "Hirist asked for a check" } : { ok: true as const, json: answer() };
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
  try {
    // 1. A search bucket: the page's listings are stored as ordinary Job rows, the call is Hirist's search with the years window.
    const bucket = await db.readerBucket.create({ data: { site: SITE, key: "backend-developer||3", kind: "search", keyword: "backend developer", location: null, experience: 3, users: 2, everyHours: 24, nextReadAt: base } });
    const run1 = await runReader(SITE, { rules, deps: fake(() => base) });
    check("a window reads the due bucket, stores its listings and records the run", run1.status === "ran" && run1.stopReason === "done" && run1.buckets === 1 && run1.pages === 1 && run1.listed === 3, JSON.stringify(run1));
    check("the call is Hirist's own search page, with the years window", urls[0] === "https://www.hirist.tech/search/backend%20developer?minexp=2&maxexp=5", urls[0]);
    const stored = await db.job.findMany({ where: { source: SITE }, select: { externalId: true, title: true, applyUrl: true } });
    check("three jobs under companies of their own, inactive", stored.length === 3 && (await db.company.count({ where: { source: SITE, active: false } })) === 2, `${stored.length} jobs`);
    check("each job's apply URL is its Hirist page, or the board it applies on", stored.some((job) => job.applyUrl === "https://www.hirist.tech/j/acme-software-senior-backend-engineer-9100001") && stored.some((job) => job.applyUrl.startsWith("https://job-boards.greenhouse.io/")));
    const after = await db.readerBucket.findUnique({ where: { id: bucket.id } });
    check("the bucket is read, not claimed, and due again after its cadence", !!after?.lastReadAt && after.claimedUntil === null && after.lastStop === "done" && after.lastListed === 3 && after.nextReadAt.getTime() > base.getTime() + 20 * 3_600_000);

    // 2. The incremental stop: a full page of jobs we already hold ends the bucket where it is.
    const full = structuredClone(search);
    full.totalJobs = 100;
    full.data = Array.from({ length: 20 }, (_, i) => ({ ...structuredClone(search.data[0]), id: Number(`${stamp}`.slice(-6)) * 100 + i, companyData: { companyId: 800000 + i, companyName: `Smoke Company ${i}`, companyStatus: 1, companyLogoFilePath: "" }, title: `Backend Developer ${i}` }));
    answer = () => full;
    await db.readerBucket.update({ where: { id: bucket.id }, data: { nextReadAt: base } });
    urls.length = 0;
    const run2 = await runReader(SITE, { rules, deps: fake(() => new Date(base.getTime() + 60_000)) });
    check("a full page of new jobs goes one page deeper, numbered", run2.status === "ran" && run2.pages === 2 && run2.listed === 40 && urls[1]?.includes("page=2"), `${JSON.stringify(run2)} ${urls.join(" ")}`);
    await db.readerBucket.update({ where: { id: bucket.id }, data: { nextReadAt: base } });
    urls.length = 0;
    const run3 = await runReader(SITE, { rules, deps: fake(() => new Date(base.getTime() + 120_000)) });
    check("a page it already has ends the bucket there, however many pages remain", run3.status === "ran" && run3.pages === 1 && urls.length === 1, JSON.stringify(run3));

    // 3. A company bucket: searched by its name alone; only that company's listings are kept.
    answer = () => search;
    await db.readerBucket.update({ where: { id: bucket.id }, data: { nextReadAt: new Date(base.getTime() + 86_400_000) } });
    const seeded = await reader.seedCompanyBuckets(SITE, ["Acme Software", "Nobody Corp"], 96, base);
    check("a list's names become company buckets once", seeded.added === 2, JSON.stringify(seeded));
    urls.length = 0;
    const before = await db.job.count({ where: { source: SITE } });
    const run4 = await runReader(SITE, { rules, deps: fake(() => new Date(base.getTime() + 180_000)) });
    check("a company's search keeps only the listings of that company", run4.status === "ran" && run4.buckets === 2 && run4.listed === 2 && (await db.job.count({ where: { source: SITE } })) === before, JSON.stringify(run4));
    check("a company is searched by its name alone: no years, no number", urls.includes("https://www.hirist.tech/search/Acme%20Software") && urls.includes("https://www.hirist.tech/search/Nobody%20Corp"), urls.join(" "));
    const nobody = await db.readerBucket.findUnique({ where: { site_key: { site: SITE, key: "co|nobody-corp" } } });
    check("a name with no jobs of its own waits about two weeks", nobody?.lastStop === "no_match" && nobody.nextReadAt.getTime() > base.getTime() + 12 * 86_400_000, `${nobody?.lastStop}`);

    // 4. The daily budget.
    const spent = (await reader.readerState(SITE, rules, base)).pagesToday;
    await db.readerBucket.updateMany({ where: { site: SITE }, data: { nextReadAt: base, claimedUntil: null } });
    const capped = await runReader(SITE, { rules: { ...rules, max_pages_per_day: spent }, deps: fake(() => base) });
    check("the day's page budget stops the reader before it opens a window", capped.status === "skipped" && capped.reason === "daily_budget", JSON.stringify(capped));

    // 5. A check ends the window and pauses the reader; the next window comes from a new address.
    await db.readerBucket.updateMany({ where: { site: SITE }, data: { nextReadAt: base, claimedUntil: null } });
    const t0 = new Date(base.getTime() + 600_000);
    const blocked = await runReader(SITE, { rules, deps: fake(() => t0, "challenge") });
    check("a check stops the window and gives its buckets back unread", blocked.status === "ran" && blocked.stopReason === "challenge" && blocked.buckets === 1 && (await db.readerBucket.count({ where: { site: SITE, claimedUntil: { not: null } } })) === 0, JSON.stringify(blocked));
    const paused = await runReader(SITE, { rules, deps: fake(() => new Date(t0.getTime() + 3_600_000)) });
    check("the reader stays paused after a check", paused.status === "skipped" && paused.reason === "paused", JSON.stringify(paused));
    owners.length = 0;
    const resumed = await runReader(SITE, { rules, deps: fake(() => new Date(t0.getTime() + (rules.pause_hours_after_challenge + 1) * 3_600_000)) });
    check("after the pause it reads again, from a new proxy address", resumed.status === "ran" && owners[0] === "reader-1-1", `${JSON.stringify(resumed)} ${owners.join(",")}`);

  } finally {
    await db.readerBucket.deleteMany({ where: { site: SITE } });
    await db.readerRun.deleteMany({ where: { site: SITE } });
    const jobs = await db.job.findMany({ where: { source: SITE }, select: { id: true } });
    await db.swipe.deleteMany({ where: { jobId: { in: jobs.map((job) => job.id) } } }).catch(() => undefined);
    await db.jobJudgement.deleteMany({ where: { jobId: { in: jobs.map((job) => job.id) } } }).catch(() => undefined);
    await db.job.deleteMany({ where: { source: SITE } });
    await db.company.deleteMany({ where: { source: SITE } });
    await db.$disconnect();
  }
}

// One real window, signed out, through the reader's own proxy address: company buckets of a few big names.
async function live() {
  const { db } = await import("../src/lib/db");
  const { readerRules } = await import("../src/modules/governance");
  const reader = await import("../src/modules/sources/reader");
  const { runReader } = await import("../src/modules/apply/sites/reader");
  const rules = readerRules("hirist");
  if (!rules) throw new Error("no reader rules for hirist");
  const names = ["Cadence Design Systems", "Flipkart", "Razorpay"];
  const seeded = await reader.seedCompanyBuckets("hirist", names, rules.company_every_hours, new Date());
  console.log(`seeded ${JSON.stringify(seeded)}`);
  await db.readerBucket.updateMany({ where: { site: "hirist", kind: "company", keyword: { in: names } }, data: { nextReadAt: new Date(), claimedUntil: null } });
  const before = await db.job.count({ where: { source: "hirist" } });
  const outcome = await runReader("hirist", { rules: { ...rules, buckets_per_run: names.length, pages_per_bucket: 1, details_per_bucket: 2, max_pages_per_day: 20, max_details_per_day: 6 } });
  console.log(`run ${JSON.stringify(outcome)}`);
  const after = await db.job.count({ where: { source: "hirist" } });
  check("a live window stores Hirist jobs and records its run", outcome.status === "ran" && outcome.listed > 0 && after > before, `${before} → ${after} jobs`);
  const detailed = await db.job.count({ where: { source: "hirist" } });
  console.log(`hirist jobs now ${detailed}`);
  await db.$disconnect();
}

(async () => {
  if (process.argv.includes("--live")) {
    await live();
    console.log(failed === 0 ? "PASS hirist-reader-test --live" : `FAIL hirist-reader-test --live (${failed})`);
  } else {
    await offline();
    console.log(failed === 0 ? "PASS hirist-reader-test" : `FAIL hirist-reader-test (${failed})`);
  }
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
