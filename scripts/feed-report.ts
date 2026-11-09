// T84: is there enough fresh work every day? For the latest ingest runs: new jobs and new India-eligible jobs, and
// companies failing. For each real profile: its tracks, the feed it sees now (India and remote-from-India, its
// tracks) by tier, how many of those are fresher roles, and how many strong or good matches were first seen in the
// last 24 hours. Reads only. npx tsx scripts/feed-report.ts [--titles]
// Phase M (M1): --from YYYY-MM-DD [--to YYYY-MM-DD] prints the BoardDay rows instead: per board and day, companies,
// open India jobs (tech, entry level), new India jobs that day, right swipes and submits, and the period's totals.
import { db } from "../src/lib/db";
import { boardDays, listFeed, parseFeedFilters, tracksOf } from "../src/modules/jobs";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function boardReport(fromText: string, toText: string | undefined) {
  const from = new Date(`${fromText}T00:00:00Z`);
  const to = toText ? new Date(`${toText}T00:00:00Z`) : new Date();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error("--from and --to take YYYY-MM-DD");
  const rows = await boardDays(from, to);
  if (!rows.length) {
    console.log(`No BoardDay rows from ${fromText} to ${toText ?? "today"} (the worker writes them at 23:30 UTC; scripts/board-day.ts writes one by hand).`);
    return;
  }
  const dayOf = (date: Date) => date.toISOString().slice(0, 10);
  console.log(`Boards per day (UTC), ${dayOf(rows[0].day)} to ${dayOf(rows[rows.length - 1].day)}:`);
  console.table(rows.map((row) => ({ day: dayOf(row.day), board: row.source, companies: row.companies, active: row.active, openIndia: row.openIndia, tech: row.openIndiaTech, entry: row.openIndiaEntry, newIndia: row.newIndia, swipesRight: row.swipesRight, submitted: row.submitted })));
  const days = new Set(rows.map((row) => row.day.getTime())).size;
  const totals = new Map<string, { newIndia: number; swipes: number; submitted: number; openIndia: number; tech: number; companies: number }>();
  for (const row of rows) {
    const total = totals.get(row.source) ?? { newIndia: 0, swipes: 0, submitted: 0, openIndia: 0, tech: 0, companies: 0 };
    total.newIndia += row.newIndia;
    total.swipes += row.swipesRight;
    total.submitted += row.submitted;
    // Rows are oldest first, so the last one seen is the latest.
    total.openIndia = row.openIndia;
    total.tech = row.openIndiaTech;
    total.companies = row.companies;
    totals.set(row.source, total);
  }
  console.log(`Per board over ${days} day(s), most new India jobs a day first:`);
  console.table(
    [...totals.entries()]
      .sort((a, b) => b[1].newIndia - a[1].newIndia)
      .map(([board, total]) => ({ board, companies: total.companies, newIndiaPerDay: Math.round((total.newIndia / days) * 10) / 10, openIndiaNow: total.openIndia, techNow: total.tech, swipesRight: total.swipes, submitted: total.submitted })),
  );
}

async function main() {
  const from = arg("--from");
  if (from) return boardReport(from, arg("--to"));
  const runs = await db.ingestRun.findMany({ orderBy: { startedAt: "desc" }, take: 8 });
  console.log("Ingest runs (newest first):");
  for (const run of runs) {
    const seconds = run.finishedAt ? Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000) : null;
    console.log(`  ${run.startedAt.toISOString().slice(0, 16)}  ${seconds == null ? "running" : `${seconds}s`}  companies ${run.companies} (failed ${run.failed})  new ${run.created} (India-eligible ${run.createdEligible})  changed ${run.updated}  closed ${run.closed}  deleted ${run.deleted}`);
  }
  const failing = await db.company.findMany({ where: { active: true, lastError: { not: null } }, select: { name: true, lastError: true } });
  if (failing.length) console.log(`Companies failing: ${failing.map((c) => `${c.name} (${c.lastError?.slice(0, 60)})`).join("; ")}`);
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const newEligible = await db.job.count({ where: { firstSeenAt: { gte: day }, closedAt: null, eligibility: { in: ["india", "remote_india"] } } });
  console.log(`India-eligible jobs first seen in the last 24 h: ${newEligible}`);

  const profiles = await db.profile.findMany({ where: { isTest: false }, select: { userId: true, fullName: true, currentTitle: true, yearsExperience: true, tracks: true, skills: true, experience: true } });
  const showTitles = process.argv.includes("--titles");
  for (const profile of profiles) {
    const feed = await listFeed(profile.userId, parseFeedFilters({}));
    const fresher = await listFeed(profile.userId, parseFeedFilters({ level: "fresher" }));
    const early = await listFeed(profile.userId, parseFeedFilters({ level: "early" }));
    const tiers = { strong: 0, good: 0, stretch: 0 };
    for (const job of feed) if (job.tier) tiers[job.tier] += 1;
    const ids = feed.filter((job) => job.tier === "strong" || job.tier === "good").map((job) => job.id);
    const fresh = ids.length ? await db.job.count({ where: { id: { in: ids }, firstSeenAt: { gte: day } } }) : 0;
    console.log(`\n${profile.fullName.split(" ")[0]} (…${profile.userId.slice(-6)}) · ${profile.currentTitle ?? "-"} · ${profile.yearsExperience ?? "?"} yrs · tracks ${tracksOf(profile).join(", ")}`);
    console.log(`  feed ${feed.length} cards (cap 40): strong ${tiers.strong}, good ${tiers.good}, stretch ${tiers.stretch}; fresher ${fresher.length}, early career ${early.length}; new strong/good in 24 h: ${fresh}`);
    if (showTitles) for (const job of feed.slice(0, 20)) console.log(`    ${job.tier?.padEnd(7)} ${String(job.score).padStart(3)}  ${job.company} · ${job.title} · ${job.location}  — ${job.reason}`);
  }
}
main().finally(() => db.$disconnect());
