// Phase P, P2 (docs/relevance/TDD.md 7.1): the relevance evaluation. For each profile with a stored round-1 pool, ranks
// the pool with the feed's own code under each field rule (old matcher, "reading decides", "title OR reading") and
// prints, against the owner's labels: precision@10 and @20 (relevant / labelled), the labelled share of the top 10
// (below 80 %: label more before deciding), cards kept, labelled cards each new rule removes or adds against the old
// matcher, relevant cards it drops from the old top 10, and the top 10 of each rule. The owner's account is printed
// but left out of the averages. Then the ml_ai mislabel count on the feed's pool. Writes nothing but EvalJudgement
// (verdicts the rankings need); JobJudgement counts are printed before and after.
// P6: the fit path (fit.ts, a dry run into EvalJudgement path "fit") is ranked under the shipped gate (title AND reading)
// and compared with title AND reading on the old judge, paired per profile, against TDD 7.1's P6 gate: p@10 up 0.10 on
// average, no profile losing more than one relevant card from its top 10, cards kept >= 30 (or >= the old count), the
// fit's "no" rate <= 0.6 of the judged shortlist. FitJudgement counts are printed before and after too.
//   npx tsx scripts/relevance-eval.ts [--owner <userId>] [--profile <id suffix>] [--top 10] [--no-fit]
import { db } from "../src/lib/db";
import { llmUsage } from "../src/lib/llm";
import { fitStats } from "../src/modules/jobs/fit";
import { evalProfiles, rankByRule, rankWithFit, readingsOf, ROUND, RULE_LABELS, RULES, type Rule } from "../src/modules/jobs/eval";
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
  const fitBefore = await db.fitJudgement.count();
  const withFit = !process.argv.includes("--no-fit");
  const fitRows: Array<{ tag: string; owner: boolean; old: Metrics; fit: Metrics; oldCards: number; noRate: number | null; judged: number }> = [];
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
    if (withFit) {
      const fitRanked = await rankWithFit(profile.userId, pool, readings);
      const base = ranked.title_and;
      const m = measure(fitRanked, base, labels);
      const verdicts = await db.evalJudgement.findMany({ where: { profileId: profile.profileId, path: "fit", jobId: { in: pool } }, select: { fit: true } });
      const noRate = verdicts.length === 0 ? null : verdicts.filter((v) => v.fit === "no").length / verdicts.length;
      fitRows.push({ tag, owner: profile.owner, old: measure(base, base, labels), fit: m, oldCards: base.length, noRate, judged: verdicts.length });
      console.log(
        `${"title AND reading + fit".padEnd(26)} ${String(m.cards).padStart(5)} ${pct(m.p10)} ${pct(m.p20)}  ${String(m.labelled10).padStart(5)}/10${m.labelled10 < 8 ? " (label more)" : "             "}  vs title AND: lost relevant@10 ${m.lostRelevant10}, new in top 20 ${m.gained20}, "no" ${pct(noRate)} of ${verdicts.length} judged`,
      );
      console.log(`  top ${top}, title AND reading + fit:`);
      fitRanked.slice(0, top).forEach((job, i) => {
        const label = labels.get(job.id);
        console.log(`   ${String(i + 1).padStart(2)}. ${label === true ? "+" : label === false ? "-" : label === null ? "?" : " "} ${job.score} ${job.title} — ${job.company} | ${job.reason.slice(0, 90)}`);
      });
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
  if (withFit && fitRows.length > 0) {
    console.log("\nP6 gate (TDD 7.1), fit vs title AND reading on the old judge, paired; the owner apart:");
    const paired = fitRows.filter((row) => !row.owner && row.old.p10 != null && row.fit.p10 != null);
    for (const row of fitRows) {
      const keptOk = row.fit.cards >= 30 || row.fit.cards >= row.oldCards;
      console.log(
        `  ${row.tag.padEnd(28)} p@10 ${pct(row.old.p10)} → ${pct(row.fit.p10)}  p@20 ${pct(row.old.p20)} → ${pct(row.fit.p20)}  lost relevant@10 ${row.fit.lostRelevant10}${row.fit.lostRelevant10 > 1 ? " FAIL" : ""}  cards ${row.oldCards} → ${row.fit.cards}${keptOk ? "" : " FAIL"}  "no" ${pct(row.noRate)} of ${row.judged}${(row.noRate ?? 0) > 0.6 ? " FAIL" : ""}`,
      );
    }
    const delta = paired.length === 0 ? null : paired.reduce((sum, row) => sum + (row.fit.p10! - row.old.p10!), 0) / paired.length;
    const mean = (pick: (row: (typeof fitRows)[number]) => number | null) => {
      const values = paired.map(pick).filter((v): v is number => v != null);
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    };
    console.log(`  average p@10 ${pct(mean((r) => r.old.p10))} → ${pct(mean((r) => r.fit.p10))} (paired delta ${delta == null ? "-" : (delta >= 0 ? "+" : "") + delta.toFixed(3)}, gate +0.10: ${delta != null && delta >= 0.1 ? "PASS" : "FAIL"}); p@20 ${pct(mean((r) => r.old.p20))} → ${pct(mean((r) => r.fit.p20))}; ${paired.length} profiles`);
    const cost = (llmUsage.input * 0.15 + llmUsage.output * 0.6) / 1e6;
    console.log(`  fit judged ${fitStats.judged} (cached ${fitStats.cached}, unread ${fitStats.unread}, evidence missed ${fitStats.evidenceMissed}, failed ${fitStats.failed}); this run's model use ${llmUsage.calls} calls, ${llmUsage.input} in / ${llmUsage.output} out, $${cost.toFixed(4)}`);
  }
  await mlAiMislabels();
  console.log(`\nJobJudgement rows ${judgedBefore} → ${await db.jobJudgement.count()}, FitJudgement rows ${fitBefore} → ${await db.fitJudgement.count()} (the eval writes none)`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
