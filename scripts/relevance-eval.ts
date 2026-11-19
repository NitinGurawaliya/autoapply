// Phase P, P2 (docs/relevance/TDD.md 7.1): the relevance evaluation. For each profile with a stored round-1 pool, ranks
// the pool with the feed's own code under each field rule (old matcher, "reading decides", "title OR reading") and
// prints, against the owner's labels: precision@10 and @20 (relevant / labelled), the labelled share of the top 10
// (below 80 %: label more before deciding), cards kept, labelled cards each new rule removes or adds against the old
// matcher, relevant cards it drops from the old top 10, and the top 10 of each rule. The owner's account is printed
// but left out of the averages. Then the ml_ai mislabel count on the feed's pool. Writes nothing but EvalJudgement
// (verdicts the rankings need); JobJudgement counts are printed before and after.
//   npx tsx scripts/relevance-eval.ts [--owner <userId>] [--profile <id suffix>] [--top 10]
import { db } from "../src/lib/db";
import { evalProfiles, rankByRule, readingsOf, ROUND, RULE_LABELS, RULES, type Rule } from "../src/modules/jobs/eval";
import type { FeedJob } from "../src/modules/jobs/match";
import { poolSql } from "../src/modules/jobs/pool";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

type Metrics = { cards: number; p10: number | null; p20: number | null; labelled10: number; removedLabelled: number; removedIrrelevant: number; lostRelevant10: number; gained20: string };

const pct = (value: number | null) => (value == null ? "  -  " : `${(100 * value).toFixed(0).padStart(3)} %`);

function precision(ranked: FeedJob[], labels: Map<string, boolean | null>, k: number) {
  const top = ranked.slice(0, k).map((job) => labels.get(job.id)).filter((label): label is boolean => typeof label === "boolean");
  return top.length === 0 ? null : top.filter(Boolean).length / top.length;
}

function measure(ranked: FeedJob[], old: FeedJob[], labels: Map<string, boolean | null>): Metrics {
  const ids = new Set(ranked.map((job) => job.id));
  const removed = old.filter((job) => !ids.has(job.id) && typeof labels.get(job.id) === "boolean");
  const top10 = new Set(ranked.slice(0, 10).map((job) => job.id));
  const top20 = new Set(ranked.slice(0, 20).map((job) => job.id));
  const oldTop20 = new Set(old.slice(0, 20).map((job) => job.id));
  const gained = [...top20].filter((id) => !oldTop20.has(id));
  const mark = (id: string) => (labels.get(id) === true ? "+" : labels.get(id) === false ? "-" : "?");
  return {
    cards: ranked.length,
    p10: precision(ranked, labels, 10),
    p20: precision(ranked, labels, 20),
    labelled10: ranked.slice(0, 10).filter((job) => typeof labels.get(job.id) === "boolean").length,
    removedLabelled: removed.length,
    removedIrrelevant: removed.filter((job) => labels.get(job.id) === false).length,
    lostRelevant10: old.slice(0, 10).filter((job) => labels.get(job.id) === true && !top10.has(job.id)).length,
    gained20: gained.length === 0 ? "none" : `${gained.length} (${gained.map(mark).join("")})`,
  };
}

async function mlAiMislabels() {
  const rows = await db.$queryRaw<Array<{ family: string | null; n: number }>>`
    SELECT j."roleFamily" AS family, count(*)::int AS n FROM "Job" j
    WHERE ${poolSql("j")} AND j.track = 'ml_ai' AND j."readingCurrent"
    GROUP BY j."roleFamily" ORDER BY n DESC`;
  const total = rows.reduce((sum, row) => sum + row.n, 0);
  const wrong = rows.filter((row) => row.family !== "ml_ai");
  const [reverse] = await db.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM "Job" j WHERE ${poolSql("j")} AND j."readingCurrent" AND j."roleFamily" = 'ml_ai' AND j.track IS DISTINCT FROM 'ml_ai'`;
  console.log(`\nml_ai by title on the feed's pool (read jobs): ${total}; the reading says another family for ${wrong.reduce((s, r) => s + r.n, 0)} (${wrong.map((r) => `${r.family ?? "null"} ${r.n}`).join(", ") || "none"})`);
  console.log(`the reading says ml_ai where the title does not: ${reverse.n}`);
}

async function main() {
  const top = Number(arg("--top") ?? 10);
  const only = arg("--profile");
  const judgedBefore = await db.jobJudgement.count();
  const profiles = (await evalProfiles(arg("--owner") ?? process.env.EVAL_OWNER_USER_ID)).filter((p) => !only || p.profileId.endsWith(only));
  const averages: Record<Rule, Array<{ p10: number | null; p20: number | null }>> = { old: [], reading: [], title_or: [], title_and: [], title_nontech: [] };
  for (const profile of profiles) {
    const pool = (await db.evalPool.findMany({ where: { profileId: profile.profileId, round: ROUND }, select: { jobId: true } })).map((row) => row.jobId);
    if (pool.length === 0) continue;
    const labels = new Map((await db.feedLabel.findMany({ where: { profileId: profile.profileId }, select: { jobId: true, relevant: true } })).map((row) => [row.jobId, row.relevant]));
    const readings = await readingsOf(pool);
    const ranked = {} as Record<Rule, FeedJob[]>;
    for (const rule of RULES) ranked[rule] = await rankByRule(profile.userId, rule, pool, readings);
    const tag = `…${profile.profileId.slice(-6)}${profile.owner ? " (owner, not averaged)" : ""}`;
    console.log(`\n=== ${tag}: pool ${pool.length}, labels ${labels.size} (${[...labels.values()].filter((v) => v === true).length} relevant) ===`);
    console.log("rule                       cards   p@10   p@20  labelled@10  removed (irrelevant)  lost relevant@10  new in top 20");
    for (const rule of RULES) {
      const m = measure(ranked[rule], ranked.old, labels);
      if (!profile.owner) averages[rule].push({ p10: m.p10, p20: m.p20 });
      const removed = rule === "old" ? "-" : `${m.removedLabelled} (${m.removedIrrelevant})`;
      console.log(
        `${RULE_LABELS[rule].padEnd(26)} ${String(m.cards).padStart(5)} ${pct(m.p10)} ${pct(m.p20)}  ${String(m.labelled10).padStart(5)}/10${m.labelled10 < 8 ? " (label more)" : "             "}  ${removed.padStart(9)}             ${rule === "old" ? "-" : String(m.lostRelevant10).padStart(2)}             ${rule === "old" ? "-" : m.gained20}`,
      );
    }
    for (const rule of RULES) {
      console.log(`  top ${top}, ${RULE_LABELS[rule]}:`);
      ranked[rule].slice(0, top).forEach((job, i) => {
        const label = labels.get(job.id);
        console.log(`   ${String(i + 1).padStart(2)}. ${label === true ? "+" : label === false ? "-" : label === null ? "?" : " "} ${job.score} ${job.title} — ${job.company}`);
      });
    }
  }
  console.log("\naverages over profiles other than the owner's (paired: each profile counts once per rule):");
  for (const rule of RULES) {
    const mean = (key: "p10" | "p20") => {
      const values = averages[rule].map((row) => row[key]).filter((value): value is number => value != null);
      return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    console.log(`  ${RULE_LABELS[rule].padEnd(26)} p@10 ${pct(mean("p10"))}  p@20 ${pct(mean("p20"))}  (${averages[rule].length} profiles)`);
  }
  await mlAiMislabels();
  console.log(`\nJobJudgement rows ${judgedBefore} → ${await db.jobJudgement.count()} (the eval writes none)`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
