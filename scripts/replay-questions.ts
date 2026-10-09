// Replay every real question in the answer bank through today's resolver and measure how much the agent would ask.
// For each saved question: if this wording appeared on a new form, WITHOUT the answer to this exact wording, would the
// agent still have to ask? When it answers, does the answer agree with what the user actually said? A disagreement on a
// sensitive key is a wrong sensitive answer and must stay 0. Read-only apart from the field-mapping cache the mapper
// already writes. Real (non-test) profiles only; prints counts and question wordings, never answer values.
// npx tsx scripts/replay-questions.ts [--list] [--user <end of the user id>]
import { db } from "../src/lib/db";
import { customQuestionKey, detectConcept, isCustomQuestionKey } from "../src/modules/answers";
import { mapFields, resolveValues } from "../src/modules/apply";
import type { FormField } from "../src/modules/apply";
import { answerFromMemory } from "../src/modules/apply/recall";
import { loadRules } from "../src/modules/governance";

const SENSITIVE = new Set(loadRules().sensitive_keys_never_ai);
const listAsked = process.argv.includes("--list");
// --no-memory replays today's deterministic resolver only (the T50 baseline); by default the T52 memory step runs too.
const useMemory = !process.argv.includes("--no-memory");
const onlyUser = process.argv.includes("--user") ? process.argv[process.argv.indexOf("--user") + 1] : undefined;

const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
// "Yes" and "Yes, I am authorized" mean the same: compare yes/no answers by their meaning, everything else as text.
const yesNo = (text: string) => (/^(yes|y|true)\b/.test(norm(text)) ? "yes" : /^(no|n|false)\b/.test(norm(text)) ? "no" : null);
const same = (a: string, b: string) => norm(a) === norm(b) || (yesNo(a) !== null && yesNo(a) === yesNo(b));

type Outcome = "asked" | "answered";
type Row = { label: string; outcome: Outcome; key: string | null; source?: string; agrees?: boolean; sensitive: boolean; given?: string; actual?: string };

async function replayUser(userId: string) {
  const [profile, answers] = await Promise.all([db.profile.findUnique({ where: { userId } }), db.answer.findMany({ where: { userId } })]);
  if (!profile) return [];
  // Every wording the user has answered under its own key is one question to replay.
  const questions = answers.filter((row) => isCustomQuestionKey(row.key) && row.question.trim());
  const fields: FormField[] = questions.map((row, index) => ({ selector: `#replay-${index}`, label: row.question, type: "text", required: true }));
  const mapped = await mapFields("greenhouse", fields);

  // One question at a time: each leaves out its own answer, so the memory step cannot share one call across them.
  const rows: Row[] = [];
  const replayOne = async (index: number) => {
    const item = mapped[index];
    const own = questions[index];
    const ownKey = customQuestionKey(item.field.label);
    const others = answers.filter((row) => row.key !== ownKey);
    let { values } = resolveValues([item], profile, others);
    if (values.length === 0 && useMemory) {
      // The job each old answer was given for was not recorded, so risky questions cannot be matched here (safe).
      const memory = await answerFromMemory({ userId, job: null, fields: [item.field], excludeKeys: [ownKey] });
      if (memory.answers.size > 0) values = resolveValues([item], profile, others, memory.answers).values;
    }
    const value = values[0];
    const sensitive = (item.key ? SENSITIVE.has(item.key) : false) || detectConcept(item.field.label) !== null;
    if (!value) rows.push({ label: item.field.label, outcome: "asked", key: item.key, sensitive });
    else rows.push({ label: item.field.label, outcome: "answered", key: value.key, source: value.source, agrees: same(value.value, own.answer), sensitive, given: value.value, actual: own.answer });
  };
  const queue = mapped.map((_, index) => index);
  await Promise.all(Array.from({ length: 6 }, async () => { for (let next = queue.shift(); next !== undefined; next = queue.shift()) await replayOne(next); }));
  return rows;
}

async function main() {
  const profiles = await db.profile.findMany({
    where: { isTest: false, user: { email: { not: { endsWith: "@swipeapply.local" } } }, ...(onlyUser ? { userId: { endsWith: onlyUser } } : {}) },
    select: { userId: true },
  });
  const all: Row[] = [];
  for (const { userId } of profiles) {
    const rows = await replayUser(userId);
    if (rows.length === 0) continue;
    const answered = rows.filter((row) => row.outcome === "answered");
    console.log(`user …${userId.slice(-6)}: ${rows.length} questions, ${answered.length} answered without asking, ${rows.length - answered.length} asked`);
    all.push(...rows);
  }

  const answered = all.filter((row) => row.outcome === "answered");
  const agree = answered.filter((row) => row.agrees);
  const wrongSensitive = answered.filter((row) => row.sensitive && !row.agrees);
  const pct = (n: number, d: number) => (d === 0 ? "0%" : `${Math.round((n / d) * 100)}%`);
  const bySource = answered.reduce<Record<string, number>>((acc, row) => ((acc[row.source ?? "?"] = (acc[row.source ?? "?"] ?? 0) + 1), acc), {});

  console.log("");
  console.log(`questions replayed:            ${all.length}`);
  console.log(`answered without asking:       ${answered.length} (${pct(answered.length, all.length)})  by source ${JSON.stringify(bySource)}`);
  console.log(`  of those, same as the user:  ${agree.length} (${pct(agree.length, answered.length)})`);
  console.log(`would still be asked:          ${all.length - answered.length} (${pct(all.length - answered.length, all.length)})`);
  console.log(`wrong sensitive answers:       ${wrongSensitive.length}  (must be 0; sensitive keys and every risky kind: work authorization, office, worked-at, EEO...)`);
  for (const row of wrongSensitive) console.log(`  WRONG SENSITIVE  ${row.key}  "${row.label.slice(0, 90)}"`);
  // Non-sensitive answers the agent gave that differ from what the user typed (sensitive values are never printed).
  if (process.argv.includes("--disagreements")) {
    console.log("\ndisagreements (non-sensitive):");
    for (const row of answered.filter((item) => !item.agrees && !item.sensitive)) console.log(`  [${row.source}] "${row.label.replace(/\s+/g, " ").slice(0, 70)}"  gave "${row.given?.slice(0, 40)}"  user said "${row.actual?.slice(0, 40)}"`);
  }
  if (listAsked) {
    console.log("\nstill asked:");
    for (const row of all.filter((item) => item.outcome === "asked")) console.log(`  ${row.label.replace(/\s+/g, " ").slice(0, 110)}`);
  }
  console.log("note: questions are replayed as plain text fields; on a real form, options can turn some answers into questions.");
  console.log(wrongSensitive.length === 0 ? "PASS replay" : "FAIL replay (wrong sensitive answers)");
  process.exit(wrongSensitive.length === 0 ? 0 : 1);
}

main().finally(() => db.$disconnect());
