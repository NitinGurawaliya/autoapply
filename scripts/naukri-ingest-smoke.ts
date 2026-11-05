// K2 (docs/naukri/TASKS.md#k2): Naukri jobs into the Job table and into the right feeds.
//
// npx tsx scripts/naukri-ingest-smoke.ts
//   No sign-in needed. Stores the fixture listings (tests/fixtures/naukri) under smoke ids: a Workday redirect is not
//   stored, a Greenhouse redirect carries applyVia, companies are inactive, a job no search has seen for 14 days closes
//   and a later sighting reopens it; with ENABLE_NAUKRI=1 a connected user's feed shows Naukri jobs ("via Naukri") and an
//   unconnected user's shows none. Its own users, jobs and companies; all removed at the end.
//
// npx tsx scripts/naukri-ingest-smoke.ts --live you@example.com
//   One real run for a connected account, in its Chrome window: Naukri's own search pages within the budget in
//   config/rules.json, the jobs stored, the run's stop reason, and those jobs in that user's feed with their tiers.
process.env.ENABLE_NAUKRI = "1";

import { readFileSync } from "node:fs";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

// Imported after ENABLE_NAUKRI is set: the feed reads it when its module loads.
async function load() {
  const { db } = await import("../src/lib/db");
  const { adapterBoardOfHost } = await import("../src/modules/jobs/boards");
  const { fromSearch } = await import("../src/modules/jobs/fetchers/naukri");
  const { storeSiteListings } = await import("../src/modules/jobs/ingest");
  const { listFeed, parseFeedFilters } = await import("../src/modules/jobs/match");
  return { db, adapterBoardOfHost, fromSearch, storeSiteListings, listFeed, parseFeedFilters };
}

async function offline() {
  const { db, adapterBoardOfHost, fromSearch, storeSiteListings, listFeed, parseFeedFilters } = await load();
  const stamp = Date.now();
  const search = JSON.parse(readFileSync("tests/fixtures/naukri/search.json", "utf8"));
  // Smoke ids, so nothing here touches a real Naukri job or company row; one more listing sent to Greenhouse.
  const extra = structuredClone(search.jobDetails[2]);
  extra.jobId = "greenhouse";
  extra.applyRedirectUrl = "https://job-boards.greenhouse.io/cisco/jobs/123456";
  extra.title = "Java Backend Developer";
  search.jobDetails.push(extra);
  for (const job of search.jobDetails) {
    job.jobId = `smoke${stamp}-${job.jobId}`;
    job.groupId = `smoke${stamp}-${job.groupId}`;
    job.createdDate = stamp - 2 * 24 * 60 * 60 * 1000;
  }
  const listings = fromSearch(search, adapterBoardOfHost).listings;
  const ids = listings.map((job) => job.externalId);
  const users: string[] = [];
  try {
    const stored = await storeSiteListings("naukri", listings, stamp - 60 * 24 * 60 * 60 * 1000);
    const rows = await db.job.findMany({ where: { source: "naukri", externalId: { in: ids } }, include: { company: { select: { active: true, source: true, logoUrl: true } } } });
    const byId = new Map(rows.map((row) => [row.externalId, row]));
    check("Naukri-apply and Greenhouse jobs stored", stored.created === 3 && rows.length === 3, `${stored.created} created, ${rows.length} rows`);
    check("a Workday redirect is not stored", !byId.has(`smoke${stamp}-311026500839`));
    const greenhouse = byId.get(`smoke${stamp}-greenhouse`);
    check("a Greenhouse redirect carries applyVia greenhouse", greenhouse?.applyVia === "greenhouse" && greenhouse.applyUrl.startsWith("https://job-boards.greenhouse.io/"), greenhouse?.applyVia ?? "missing");
    const own = byId.get(`smoke${stamp}-301026015262`);
    check("Naukri's own apply has no applyVia and its job page as URL", own?.applyVia === null && own.applyUrl.startsWith("https://www.naukri.com/job-listings-"));
    check("tagged India-eligible", rows.every((row) => row.eligibility === "india" && row.country === "IN"), rows.map((row) => row.eligibility).join(","));
    check("companies are Naukri's and inactive (never fetched per company)", rows.every((row) => row.company.source === "naukri" && !row.company.active));

    // Stored again unchanged: nothing rewritten.
    const again = await storeSiteListings("naukri", listings, stamp - 60 * 24 * 60 * 60 * 1000);
    check("a second run with nothing new writes nothing", again.created === 0 && again.updated === 0, JSON.stringify(again));

    // 14 days unseen by every search: closed; seen again: open.
    await db.job.update({ where: { source_externalId: { source: "naukri", externalId: own!.externalId } }, data: { fetchedAt: new Date(stamp - 15 * 24 * 60 * 60 * 1000) } });
    const swept = await storeSiteListings("naukri", [], 0);
    const closedRow = await db.job.findUnique({ where: { source_externalId: { source: "naukri", externalId: own!.externalId } }, select: { closedAt: true } });
    check("unseen for 14 days: closed", swept.closed >= 1 && closedRow?.closedAt != null);
    await storeSiteListings("naukri", listings.filter((job) => job.externalId === own!.externalId), 0);
    const reopened = await db.job.findUnique({ where: { source_externalId: { source: "naukri", externalId: own!.externalId } }, select: { closedAt: true } });
    check("seen again: reopened", reopened?.closedAt === null);

    // Feeds: a connected user sees Naukri jobs, an unconnected one none.
    const person = async (label: string) => {
      const user = await db.user.create({ data: { email: `naukri-ingest-${label}-${stamp}@swipeapply.local` } });
      users.push(user.id);
      await db.profile.create({
        data: { userId: user.id, isTest: false, resumeKey: "x", resumeText: "Full stack developer, Java, Spring Boot, Angular, React", fullName: `Ingest ${label}`, email: user.email, city: "Bengaluru", country: "India", yearsExperience: 2, currentTitle: "Full Stack Developer", tracks: ["fullstack", "backend"], skills: ["Java", "Spring Boot", "Angular", "React.js", "Microservices", "REST"], experience: [], education: [], rawJson: {} },
      });
      return user.id;
    };
    const connected = await person("connected");
    const stranger = await person("stranger");
    await db.siteConnection.create({ data: { userId: connected, site: "naukri", status: "connected", consentAt: new Date(), stateKey: `browser-state/${connected}/naukri.json` } });
    const filters = parseFeedFilters({});
    check("ENABLE_NAUKRI puts Naukri in the default boards", filters.boards.includes("naukri"));
    const mine = (await listFeed(connected, filters)).filter((job) => ids.includes(job.id) || job.source === "naukri");
    const theirs = (await listFeed(stranger, filters)).filter((job) => job.source === "naukri");
    const ours = mine.filter((job) => rows.some((row) => row.id === job.id));
    check("a connected user's feed shows Naukri jobs", ours.length > 0, ours.map((job) => `${job.title} (${job.tier ?? "no tier"}, ${job.score})`).join("; ") || "none");
    check("an unconnected user's feed shows no Naukri job", theirs.length === 0, `${theirs.length}`);
    const explicit = (await listFeed(stranger, parseFeedFilters({ boards: "naukri" }))).filter((job) => job.source === "naukri");
    check("asking for Naukri by filter does not show it either", explicit.length === 0);
  } finally {
    for (const id of users) await db.user.delete({ where: { id } }).catch(() => undefined);
    const jobs = await db.job.findMany({ where: { source: "naukri", externalId: { startsWith: `smoke${stamp}-` } }, select: { id: true } });
    await db.swipe.deleteMany({ where: { jobId: { in: jobs.map((job) => job.id) } } });
    await db.jobJudgement.deleteMany({ where: { jobId: { in: jobs.map((job) => job.id) } } }).catch(() => undefined);
    await db.job.deleteMany({ where: { id: { in: jobs.map((job) => job.id) } } });
    await db.company.deleteMany({ where: { source: "naukri", slug: { startsWith: `smoke${stamp}-` } } });
    await db.$disconnect();
  }
}

async function live(email: string) {
  const { db, listFeed, parseFeedFilters } = await load();
  const { runSourceIngest } = await import("../src/modules/apply/sites/ingest");
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error(`no user ${email}`);
  const outcome = await runSourceIngest(user.id, "naukri", { log: (line) => console.log(`run: ${line}`) });
  check("the run ran", outcome.status === "ran", JSON.stringify(outcome));
  if (outcome.status !== "ran") return;
  check("it read Naukri's listings", outcome.listed > 0, `${outcome.listed} listed, ${outcome.details} job pages, ${outcome.created} new, ${outcome.updated} changed`);
  check("it stopped at the budget (more results were there)", outcome.stopReason === "budget", outcome.stopReason);
  const feed = (await listFeed(user.id, parseFeedFilters({}))).filter((job) => job.source === "naukri");
  check("Naukri jobs in this user's feed, with tiers", feed.length > 0 && feed.some((job) => job.tier !== null), `${feed.length} cards; first: ${feed.slice(0, 3).map((job) => `${job.company} · ${job.title} (${job.tier})`).join("; ")}`);
}

async function main() {
  const [mode, arg] = process.argv.slice(2);
  if (mode === "--live") await live(arg);
  else await offline();
  console.log(failed === 0 ? "PASS naukri-ingest-smoke" : `FAIL naukri-ingest-smoke (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
