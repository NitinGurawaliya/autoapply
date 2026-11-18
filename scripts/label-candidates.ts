// Phase P, P2 (docs/relevance/TDD.md 7.1): round-1 labels for the relevance evaluation.
//
// Without --label: for each real profile with 20+ swipes that has no round-1 pool yet, stores today's pool in EvalPool
// (the feed's open, recent, unswiped jobs passing the hard gates, no field gate) and marks the candidates to label:
// the top 20 of the old matcher, of "reading decides" and of "title OR reading" (each ranked by the feed's own code
// within the pool), up to 15 of the old matcher's cards a new rule removes, plus 10 random pool jobs. Verdicts the rankings need go to EvalJudgement only.
//
// With --label: a terminal prompt, one candidate at a time, shuffled and without its source: the profile's brief
// (tracks, years, title, top skills; no contact data) and the start of the posting. Answers go to FeedLabel.
//
//   npx tsx scripts/label-candidates.ts [--owner <userId>] [--profile <id suffix>] [--rebuild]
//   npx tsx scripts/label-candidates.ts --label [--profile <id suffix>]
import { createInterface } from "node:readline/promises";
import { db } from "../src/lib/db";
import { briefOf, currentPool, evalProfiles, rankByRule, readingsOf, ROUND, RULES, type Rule } from "../src/modules/jobs/eval";
import { decodeEntities } from "../src/modules/jobs/reading";

const TOP = 20;
const RANDOM = 10;
const REMOVED = 15;
const OPENING_CHARS = 900;

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

/** A shuffle that is the same every time for the same seed text, so a stopped labelling session resumes in order. */
function shuffled<T>(items: T[], seed: string) {
  let state = [...seed].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function build(ownerUserId: string | undefined, only: string | undefined, rebuild: boolean) {
  const profiles = (await evalProfiles(ownerUserId)).filter((p) => !only || p.profileId.endsWith(only));
  console.log(`${profiles.length} profiles with 20+ swipes`);
  const judgedBefore = await db.jobJudgement.count();
  for (const profile of profiles) {
    const tag = `…${profile.profileId.slice(-6)}${profile.owner ? " (owner)" : ""}`;
    const existing = await db.evalPool.count({ where: { profileId: profile.profileId, round: ROUND } });
    if (existing > 0 && !rebuild) {
      console.log(`${tag}: round ${ROUND} pool already stored (${existing} jobs); --rebuild to replace it`);
      continue;
    }
    const pool = await currentPool(profile.userId);
    if (pool.length === 0) {
      console.log(`${tag}: empty pool, skipped`);
      continue;
    }
    const readings = await readingsOf(pool);
    const picks = new Map<string, Set<string>>();
    const ranked = {} as Record<Rule, string[]>;
    for (const rule of RULES) {
      ranked[rule] = (await rankByRule(profile.userId, rule, pool, readings)).map((job) => job.id);
      for (const id of ranked[rule].slice(0, TOP)) picks.set(id, (picks.get(id) ?? new Set()).add(rule));
      console.log(`${tag}: ${rule} ranks ${ranked[rule].length} cards`);
    }
    // Cards a new rule takes off the old matcher's list, wherever they ranked: labelled, they show whether the
    // reading removes the wrong jobs (owner, 19 Nov). A fixed sample of REMOVED when there are more.
    const removedBy = new Map<string, string[]>();
    for (const rule of RULES.filter((r) => r !== "old")) {
      const kept = new Set(ranked[rule]);
      for (const id of ranked.old.filter((id) => !kept.has(id))) removedBy.set(id, [...(removedBy.get(id) ?? []), `removed_by_${rule}`]);
    }
    const removed = shuffled([...removedBy.keys()], `${profile.profileId}:${ROUND}:removed`).slice(0, REMOVED);
    for (const id of removed) picks.set(id, new Set([...(picks.get(id) ?? []), ...removedBy.get(id)!]));
    const rest = shuffled(pool.filter((id) => !picks.has(id)), `${profile.profileId}:${ROUND}`);
    for (const id of rest.slice(0, RANDOM)) picks.set(id, new Set(["random"]));
    await db.$transaction([
      db.evalPool.deleteMany({ where: { profileId: profile.profileId, round: ROUND } }),
      db.evalPool.createMany({
        data: pool.map((jobId) => ({ profileId: profile.profileId, round: ROUND, jobId, source: [...(picks.get(jobId) ?? ["pool"])].sort().join(",") })),
      }),
    ]);
    const read = [...readings.values()].filter((r) => r.readingCurrent).length;
    console.log(`${tag}: pool ${pool.length} (${read} read), ${removedBy.size} removed by a new rule (${removed.length} sampled), ${picks.size} to label`);
  }
  const judgedAfter = await db.jobJudgement.count();
  console.log(`JobJudgement rows ${judgedBefore} → ${judgedAfter} (the eval writes none)`);
}

async function label(only: string | undefined) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const pools = await db.evalPool.groupBy({ by: ["profileId"], where: { round: ROUND, ...(only ? { profileId: { endsWith: only } } : {}) } });
    for (const { profileId } of pools) {
      const candidates = await db.evalPool.findMany({ where: { profileId, round: ROUND, NOT: { source: "pool" } }, select: { jobId: true } });
      const labelled = new Set((await db.feedLabel.findMany({ where: { profileId }, select: { jobId: true } })).map((row) => row.jobId));
      const todo = shuffled(candidates.map((row) => row.jobId).filter((id) => !labelled.has(id)), `${profileId}:label`);
      if (todo.length === 0) continue;
      const brief = await briefOf(profileId);
      console.log(`\n=== Profile …${profileId.slice(-6)}: ${todo.length} to label ===`);
      console.log(`Title: ${brief.title ?? "none"} · ${brief.years ?? "?"} years · tracks: ${brief.tracks.join(", ") || "none"}`);
      console.log(`Top skills: ${brief.skills.join(", ") || "none"}\n`);
      for (const [index, jobId] of todo.entries()) {
        const job = await db.job.findUnique({ where: { id: jobId }, select: { title: true, location: true, description: true, company: { select: { name: true } } } });
        if (!job) continue;
        const opening = decodeEntities(job.description).replace(/\s+/g, " ").trim().slice(0, OPENING_CHARS);
        console.log(`--- ${index + 1}/${todo.length} · ${job.title} — ${job.company.name} · ${job.location}`);
        console.log(`${opening}${job.description.length > OPENING_CHARS ? " …" : ""}\n`);
        const answer = (await terminal.question("Relevant for this profile? y / n / ? (can't tell) / s (skip) / q (quit): ")).trim().toLowerCase();
        if (answer === "q") return;
        if (answer === "s" || !["y", "n", "?"].includes(answer)) continue;
        const relevant = answer === "y" ? true : answer === "n" ? false : null;
        await db.feedLabel.upsert({
          where: { profileId_jobId: { profileId, jobId } },
          create: { profileId, jobId, relevant, by: "owner", round: ROUND },
          update: { relevant, by: "owner", round: ROUND, at: new Date() },
        });
      }
    }
    console.log("\nNothing left to label.");
  } finally {
    terminal.close();
  }
}

async function main() {
  const only = arg("--profile");
  if (process.argv.includes("--label")) await label(only);
  else await build(arg("--owner") ?? process.env.EVAL_OWNER_USER_ID, only, process.argv.includes("--rebuild"));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
