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
//
// Round 2 (P6, TDD 7.1): `--round 2` marks, within each profile's round-1 pool, the fit path's top 20 not yet labelled
// (rankWithFit, a dry run) and as many random unlabelled pool jobs, stored as EvalPool round 2 rows (the pool itself
// stays round 1's). `--export <file>` writes a round's unlabelled candidates for blind labellers (shuffled, no source:
// the brief and the posting's opening only); `--import <file>` stores their answers ([{profileId, jobId, relevant, by}]).
//   npx tsx scripts/label-candidates.ts --round 2 [--profile <id suffix>]
//   npx tsx scripts/label-candidates.ts --round 2 --export <file> | --import <file> | --label
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { db } from "../src/lib/db";
import { briefOf, currentPool, evalProfiles, rankByRule, rankWithFit, readingsOf, ROUND, RULES, type Rule } from "../src/modules/jobs/eval";
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

/** Round 2 (P6): the fit path's unlabelled top 20 and as many random unlabelled pool jobs, per profile. */
async function buildRound2(ownerUserId: string | undefined, only: string | undefined) {
  const profiles = (await evalProfiles(ownerUserId)).filter((p) => !only || p.profileId.endsWith(only));
  for (const profile of profiles) {
    const tag = `…${profile.profileId.slice(-6)}${profile.owner ? " (owner)" : ""}`;
    const pool = (await db.evalPool.findMany({ where: { profileId: profile.profileId, round: ROUND }, select: { jobId: true } })).map((row) => row.jobId);
    if (pool.length === 0) continue;
    const labelled = new Set((await db.feedLabel.findMany({ where: { profileId: profile.profileId }, select: { jobId: true } })).map((row) => row.jobId));
    const ranked = await rankWithFit(profile.userId, pool, await readingsOf(pool));
    const picks = ranked.slice(0, TOP).map((job) => job.id).filter((id) => !labelled.has(id));
    const random = shuffled(pool.filter((id) => !labelled.has(id) && !picks.includes(id)), `${profile.profileId}:2`).slice(0, picks.length);
    await db.$transaction([
      db.evalPool.deleteMany({ where: { profileId: profile.profileId, round: 2 } }),
      db.evalPool.createMany({ data: [...picks.map((jobId) => ({ jobId, source: "fit" })), ...random.map((jobId) => ({ jobId, source: "random" }))].map((row) => ({ ...row, profileId: profile.profileId, round: 2 })) }),
    ]);
    console.log(`${tag}: fit ranks ${ranked.length} cards; ${picks.length} of its top ${TOP} unlabelled, plus ${random.length} random`);
  }
}

/** The round's unlabelled candidates, shuffled per profile and without their source, for blind labellers. */
async function exportRound(round: number, file: string, only: string | undefined) {
  const pools = await db.evalPool.groupBy({ by: ["profileId"], where: { round, NOT: { source: "pool" }, ...(only ? { profileId: { endsWith: only } } : {}) } });
  const out = [];
  for (const { profileId } of pools) {
    const candidates = await db.evalPool.findMany({ where: { profileId, round, NOT: { source: "pool" } }, select: { jobId: true } });
    const labelled = new Set((await db.feedLabel.findMany({ where: { profileId }, select: { jobId: true } })).map((row) => row.jobId));
    const brief = await briefOf(profileId);
    for (const jobId of shuffled(candidates.map((row) => row.jobId).filter((id) => !labelled.has(id)), `${profileId}:label:${round}`)) {
      const job = await db.job.findUnique({ where: { id: jobId }, select: { title: true, location: true, description: true, company: { select: { name: true } } } });
      if (!job) continue;
      const opening = decodeEntities(job.description).replace(/\s+/g, " ").trim().slice(0, OPENING_CHARS);
      out.push({ profileId, jobId, brief, title: job.title, company: job.company.name, location: job.location, opening });
    }
  }
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`${out.length} candidates written to ${file}`);
}

/** Stores labellers' answers for a round: [{ profileId, jobId, relevant: true | false | null, by }]. */
async function importRound(round: number, file: string) {
  const rows = JSON.parse(readFileSync(file, "utf8")) as Array<{ profileId: string; jobId: string; relevant: boolean | null; by: string }>;
  for (const row of rows) {
    await db.feedLabel.upsert({
      where: { profileId_jobId: { profileId: row.profileId, jobId: row.jobId } },
      create: { profileId: row.profileId, jobId: row.jobId, relevant: row.relevant, by: row.by, round },
      update: { relevant: row.relevant, by: row.by, round, at: new Date() },
    });
  }
  console.log(`${rows.length} labels stored for round ${round}`);
}

async function label(only: string | undefined, round: number) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const pools = await db.evalPool.groupBy({ by: ["profileId"], where: { round, ...(only ? { profileId: { endsWith: only } } : {}) } });
    for (const { profileId } of pools) {
      const candidates = await db.evalPool.findMany({ where: { profileId, round, NOT: { source: "pool" } }, select: { jobId: true } });
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
          create: { profileId, jobId, relevant, by: "owner", round },
          update: { relevant, by: "owner", round, at: new Date() },
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
  const round = Number(arg("--round") ?? ROUND);
  const owner = arg("--owner") ?? process.env.EVAL_OWNER_USER_ID;
  if (arg("--export")) await exportRound(round, arg("--export")!, only);
  else if (arg("--import")) await importRound(round, arg("--import")!);
  else if (process.argv.includes("--label")) await label(only, round);
  else if (round === 2) await buildRound2(owner, only);
  else await build(arg("--owner") ?? process.env.EVAL_OWNER_USER_ID, only, process.argv.includes("--rebuild"));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
