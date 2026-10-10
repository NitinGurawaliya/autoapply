// Screens are built from components/ui and components/patterns only (docs/DESIGN.md): no hex colours and no inline
// styles in src/app. npx tsx scripts/ui-lint.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Screens not rebuilt to the design yet (Phase G). Each screen task removes its files from this list.
const LEGACY = new Set<string>([]);
// The mock ATS form imitates another site, and the gallery shows raw primitives: both are out of scope.
const SKIP = ["src/app/mock/", "src/app/dev/"];

const RULES: Array<[RegExp, string]> = [
  [/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-zA-Z-])/, "hex colour"],
  [/style=\{\{/, "inline style"],
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

let failed = 0;
let skipped = 0;
for (const path of files("src/app")) {
  const rel = path.replaceAll("\\", "/");
  if (SKIP.some((prefix) => rel.startsWith(prefix))) continue;
  if (LEGACY.has(rel)) {
    skipped += 1;
    continue;
  }
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, index) => {
      for (const [pattern, what] of RULES) {
        if (pattern.test(line)) {
          failed += 1;
          console.log(`FAIL ${rel}:${index + 1} ${what}: ${line.trim().slice(0, 100)}`);
        }
      }
    });
}
console.log(`${skipped} legacy file(s) not checked yet`);
console.log(failed === 0 ? "PASS ui-lint" : `FAIL ui-lint (${failed})`);
process.exit(failed === 0 ? 0 : 1);
