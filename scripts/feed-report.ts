// T84: is there enough fresh work every day? For the latest ingest runs: new jobs and new India-eligible jobs, and
// companies failing. For each real profile: its tracks, the feed it sees now (India and remote-from-India, its
// tracks) by tier, how many of those are fresher roles, and how many strong or good matches were first seen in the
// last 24 hours. Reads only. npx tsx scripts/feed-report.ts [--titles]
import { db } from "../src/lib/db";
import { listFeed, parseFeedFilters, tracksOf } from "../src/modules/jobs";

async function main() {
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
    const tiers = { strong: 0, good: 0, stretch: 0 };
    for (const job of feed) if (job.tier) tiers[job.tier] += 1;
    const ids = feed.filter((job) => job.tier === "strong" || job.tier === "good").map((job) => job.id);
    const fresh = ids.length ? await db.job.count({ where: { id: { in: ids }, firstSeenAt: { gte: day } } }) : 0;
    console.log(`\n${profile.fullName.split(" ")[0]} (…${profile.userId.slice(-6)}) · ${profile.currentTitle ?? "-"} · ${profile.yearsExperience ?? "?"} yrs · tracks ${tracksOf(profile).join(", ")}`);
    console.log(`  feed ${feed.length} cards (cap 40): strong ${tiers.strong}, good ${tiers.good}, stretch ${tiers.stretch}; fresher filter ${fresher.length}; new strong/good in 24 h: ${fresh}`);
    if (showTitles) for (const job of feed.slice(0, 20)) console.log(`    ${job.tier?.padEnd(7)} ${String(job.score).padStart(3)}  ${job.company} · ${job.title} · ${job.location}  — ${job.reason}`);
  }
}
main().finally(() => db.$disconnect());
