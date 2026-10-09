// T49 decision gate: how close do real application questions sit in embedding space?
// Embeds every distinct question wording real users have answered, prints each one's nearest neighbour, and compares
// true paraphrases (should share an answer) with look-alike traps (must not). Prints wordings and scores only, never
// answers. Real (non-test) users only. Costs a few cents of embeddings.
// npx tsx scripts/embedding-experiment.ts [--neighbours]
import { db } from "../src/lib/db";
import { embed } from "../src/lib/llm";
import { isCustomQuestionKey } from "../src/modules/answers";

const showNeighbours = process.argv.includes("--neighbours");
const clean = (text: string) => text.replace(/\s+/g, " ").trim();

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
}

// Groups of wordings that must share one answer (paraphrases), and pairs that must not (traps). A trap pair is two
// wordings matching the same pattern but naming a different company / city / skill (the captured group differs).
const PARAPHRASES: Array<[string, RegExp]> = [
  ["how heard", /^how did you (hear|learn|find out) about/i],
  ["work authorization, job's country", /authori[sz]ed to work in the country (where|in which)/i],
  ["home zip code", /zip code/i],
];
const TRAPS: Array<[string, RegExp]> = [
  ["worked at <company>", /(?:worked|been employed) (?:at|for|by) ([A-Z][\w.&-]+)/i],
  ["work from our <city> office", /work from our ([A-Z][\w ]+?) office/i],
  ["N years of experience in <skill>", /years of experience (?:in|with) (.+?)\??$/i],
];

async function main() {
  const rows = await db.answer.findMany({
    where: { user: { email: { not: { endsWith: "@swipeapply.local" } }, profile: { is: { isTest: false } } } },
    select: { key: true, question: true },
  });
  const labels = [...new Set(rows.filter((row) => isCustomQuestionKey(row.key)).map((row) => clean(row.question)).filter(Boolean))];
  console.log(`distinct answered question wordings (real users): ${labels.length}`);
  if (labels.length < 2) {
    console.log("FAIL embedding-experiment (not enough questions)");
    process.exit(1);
  }
  const vectors = await embed(labels);

  // Nearest neighbour of every wording.
  const nearest = labels.map((label, i) => {
    let best = -1;
    let score = -1;
    for (let j = 0; j < labels.length; j += 1) {
      if (j === i) continue;
      const s = cosine(vectors[i], vectors[j]);
      if (s > score) {
        score = s;
        best = j;
      }
    }
    return { label, neighbour: labels[best], score };
  });
  const buckets = [0.95, 0.9, 0.85, 0.8, 0.7, 0];
  console.log("\nnearest-neighbour score distribution:");
  let previous = 1.01;
  for (const floor of buckets) {
    const count = nearest.filter((n) => n.score >= floor && n.score < previous).length;
    console.log(`  ${floor.toFixed(2)}–${Math.min(previous, 1).toFixed(2)}: ${count}`);
    previous = floor;
  }

  const pairScores = (members: number[]) => {
    const out: Array<{ a: string; b: string; score: number }> = [];
    for (let x = 0; x < members.length; x += 1)
      for (let y = x + 1; y < members.length; y += 1) out.push({ a: labels[members[x]], b: labels[members[y]], score: cosine(vectors[members[x]], vectors[members[y]]) });
    return out;
  };

  console.log("\ntrue paraphrases (should share an answer):");
  const paraphraseScores: number[] = [];
  for (const [name, pattern] of PARAPHRASES) {
    const members = labels.flatMap((label, i) => (pattern.test(label) ? [i] : []));
    const pairs = pairScores(members);
    if (pairs.length === 0) {
      console.log(`  ${name}: fewer than 2 wordings`);
      continue;
    }
    pairs.forEach((p) => paraphraseScores.push(p.score));
    const lo = pairs.reduce((m, p) => (p.score < m.score ? p : m));
    console.log(`  ${name}: ${members.length} wordings, scores ${lo.score.toFixed(3)}–${Math.max(...pairs.map((p) => p.score)).toFixed(3)}`);
    console.log(`     lowest: "${lo.a.slice(0, 70)}" ~ "${lo.b.slice(0, 70)}"`);
  }

  console.log("\nlook-alike traps (must NOT share an answer):");
  const trapScores: number[] = [];
  for (const [name, pattern] of TRAPS) {
    const members = labels.flatMap((label, i) => (pattern.test(label) ? [i] : []));
    const differing = pairScores(members).filter((p) => p.a.match(pattern)?.[1]?.toLowerCase() !== p.b.match(pattern)?.[1]?.toLowerCase());
    if (differing.length === 0) {
      console.log(`  ${name}: no pair with a different ${name.split("<")[1]?.replace(">", "") ?? "value"}`);
      continue;
    }
    differing.forEach((p) => trapScores.push(p.score));
    const hi = differing.reduce((m, p) => (p.score > m.score ? p : m));
    console.log(`  ${name}: ${differing.length} pairs, scores ${Math.min(...differing.map((p) => p.score)).toFixed(3)}–${hi.score.toFixed(3)}`);
    console.log(`     highest: "${hi.a.slice(0, 70)}" ~ "${hi.b.slice(0, 70)}"`);
  }

  if (showNeighbours) {
    console.log("\nevery wording and its nearest neighbour:");
    for (const n of [...nearest].sort((a, b) => b.score - a.score)) console.log(`  ${n.score.toFixed(3)}  "${n.label.slice(0, 60)}" ~ "${n.neighbour.slice(0, 60)}"`);
  }

  const minParaphrase = paraphraseScores.length ? Math.min(...paraphraseScores) : null;
  const maxTrap = trapScores.length ? Math.max(...trapScores) : null;
  console.log("\nsummary:");
  console.log(`  lowest true-paraphrase score: ${minParaphrase?.toFixed(3) ?? "n/a"}`);
  console.log(`  highest trap score:           ${maxTrap?.toFixed(3) ?? "n/a"}`);
  if (minParaphrase !== null && maxTrap !== null) {
    console.log(`  separable by a threshold alone: ${maxTrap < minParaphrase ? "yes" : "NO — traps score as high as paraphrases, so the verify step is required"}`);
    console.log(`  suggested retrieval cut-off (send candidates to verify at or above): ${(Math.floor((minParaphrase - 0.05) * 100) / 100).toFixed(2)}`);
  }
  console.log("PASS embedding-experiment");
}

main().finally(() => db.$disconnect());
