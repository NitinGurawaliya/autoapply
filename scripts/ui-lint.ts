// Counts the UI patterns the craft audit names (docs/ui-craft/AUDIT.md section 1), per file, so Phase O can drive them
// to zero screen by screen and nothing adds new ones. Reads src/app and src/components (.tsx).
//   npx tsx scripts/ui-lint.ts                  per-file table (worst first) and totals
//   npx tsx scripts/ui-lint.ts --all            every file, not just the top 25
//   npx tsx scripts/ui-lint.ts --write-baseline save today's counts to docs/ui-craft/ui-lint-baseline.json
//   npx tsx scripts/ui-lint.ts --check          FAIL if any file has more of any pattern than its baseline
//   npx tsx scripts/ui-lint.ts <path-substring> only files whose path contains it (e.g. job-card)
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const RULES: Array<{ key: string; what: string; pattern: RegExp }> = [
  { key: "text-px", what: "arbitrary font size, text-[13px]", pattern: /\btext-\[[0-9.]+px\]/g },
  { key: "px", what: "any other arbitrary [Npx] value", pattern: /(?<!text-)\[[0-9.]+px\]/g },
  { key: "caps", what: "uppercase labels", pattern: /\buppercase\b/g },
  { key: "tracking", what: "hand-set letter spacing, tracking-[…]", pattern: /\btracking-\[[^\]]+\]/g },
  { key: "pill", what: "rounded-full (pills only for toggles)", pattern: /\brounded-full\b/g },
  { key: "hard", what: "offset shadows, shadow-hard / shadow-button", pattern: /\bshadow-(?:hard-lg|hard|button)\b/g },
  { key: "display", what: "the classic display face, font-display / font-extrabold / type-display-*", pattern: /\bfont-display\b|\bfont-extrabold\b|\btype-display-[a-z0-9]+/g },
  { key: "thick", what: "2 px and 1.5 px borders", pattern: /\bborder-2\b|\bborder-\[1\.5px\]/g },
  { key: "old-type", what: "classic type utilities, type-lead / callout / caption / title / eyebrow", pattern: /\btype-(?:lead|callout|caption|title|eyebrow)\b/g },
  { key: "raw-colour", what: "a colour written in a component, #hex or rgb()", pattern: /#[0-9a-fA-F]{3,8}\b|\brgba?\(/g },
];

const ROOTS = ["src/app", "src/components"];
const BASELINE = "docs/ui-craft/ui-lint-baseline.json";
type Counts = Record<string, Record<string, number>>;

function files(): string[] {
  return ROOTS.flatMap((root) =>
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
      .map((entry) => path.join(entry.parentPath, entry.name).split(path.sep).join("/")),
  ).sort();
}

function count(file: string): Record<string, number> {
  // Comments describe the old look as often as they use it; only code counts.
  const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const out: Record<string, number> = {};
  for (const rule of RULES) {
    const n = code.match(rule.pattern)?.length ?? 0;
    if (n > 0) out[rule.key] = n;
  }
  return out;
}

const args = process.argv.slice(2);
const filter = args.find((arg) => !arg.startsWith("--"));
const counts: Counts = {};
for (const file of files()) {
  if (filter && !file.includes(filter)) continue;
  const c = count(file);
  if (Object.keys(c).length > 0) counts[file] = c;
}
const total = (c: Record<string, number>) => Object.values(c).reduce((sum, n) => sum + n, 0);

if (args.includes("--write-baseline")) {
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 1)}\n`);
  console.log(`ui-lint: baseline written to ${BASELINE} (${Object.keys(counts).length} files, ${Object.values(counts).reduce((s, c) => s + total(c), 0)} hits)`);
  process.exit(0);
}

if (args.includes("--check")) {
  if (!existsSync(BASELINE)) {
    console.log(`FAIL ui-lint: no baseline at ${BASELINE}; run with --write-baseline first`);
    process.exit(1);
  }
  const base = JSON.parse(readFileSync(BASELINE, "utf8")) as Counts;
  const worse: string[] = [];
  let better = 0;
  for (const [file, c] of Object.entries(counts)) {
    for (const [key, n] of Object.entries(c)) {
      const was = base[file]?.[key] ?? 0;
      if (n > was) worse.push(`${file}: ${key} ${was} → ${n}`);
    }
  }
  for (const [file, c] of Object.entries(base)) for (const [key, n] of Object.entries(c)) better += Math.max(0, n - (counts[file]?.[key] ?? 0));
  for (const line of worse) console.log(`  more than baseline: ${line}`);
  console.log(`${worse.length === 0 ? "PASS" : "FAIL"} ui-lint: ${worse.length} increases, ${better} fewer hits than the baseline`);
  process.exit(worse.length === 0 ? 0 : 1);
}

const rows = Object.entries(counts).sort((a, b) => total(b[1]) - total(a[1]));
const shown = args.includes("--all") || filter ? rows : rows.slice(0, 25);
const keys = RULES.map((rule) => rule.key);
console.log(`${"file".padEnd(58)} ${keys.map((key) => key.padStart(key.length)).join(" ")}  total`);
for (const [file, c] of shown) console.log(`${file.replace(/^src\//, "").slice(0, 58).padEnd(58)} ${keys.map((key) => String(c[key] ?? "·").padStart(key.length)).join(" ")}  ${total(c)}`);
if (shown.length < rows.length) console.log(`… ${rows.length - shown.length} more files (--all)`);
const sums = Object.fromEntries(keys.map((key) => [key, rows.reduce((s, [, c]) => s + (c[key] ?? 0), 0)]));
console.log(`${"total".padEnd(58)} ${keys.map((key) => String(sums[key]).padStart(key.length)).join(" ")}  ${Object.values(sums).reduce((s, n) => s + n, 0)}`);
for (const rule of RULES) console.log(`  ${rule.key.padEnd(10)} ${rule.what}`);
