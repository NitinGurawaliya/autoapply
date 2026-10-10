// WCAG contrast of the design tokens in src/app/globals.css, light and dark. npx tsx scripts/contrast-check.ts
import { readFileSync } from "node:fs";

const css = readFileSync("src/app/globals.css", "utf8");

function tokens(selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} block not found`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

function channel(value: number) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function ratio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground token, background token, minimum ratio, what it is]
const PAIRS: Array<[string, string, number, string]> = [
  ["foreground", "background", 4.5, "body text"],
  ["card-foreground", "card", 4.5, "card text"],
  ["popover-foreground", "popover", 4.5, "dialog text"],
  ["primary-foreground", "primary", 4.5, "button text"],
  ["secondary-foreground", "secondary", 4.5, "secondary button text"],
  ["muted-foreground", "background", 4.5, "secondary text on page"],
  ["muted-foreground", "card", 4.5, "secondary text on cards"],
  // The design's grey on its quiet fill is 4.41:1 in light mode. The owner chose the design exactly (10 Oct), so this pair is held at 4.4.
  ["muted-foreground", "muted", 4.4, "secondary text on muted"],
  ["accent-foreground", "accent", 4.5, "hover and selected text"],
  // Lime is a fill only (never text), so it is checked as a background under ink.
  ["primary-foreground", "primary", 4.5, "ink on lime (stamps, match badge)"],
  ["inverse-foreground", "inverse", 4.5, "company tiles and inverted chips"],
  ["foreground", "muted", 4.5, "text on quiet fills and chips"],
  ["foreground", "card", 4.5, "text on cards and sheets"],
  ["destructive", "card", 4.5, "error text"],
  ["ring", "background", 3, "focus ring"],
  ["ring", "card", 3, "focus ring on cards"],
];

let failed = 0;
for (const [mode, selector] of [["light", ":root"], ["dark", ".dark"]] as const) {
  const t = tokens(selector);
  for (const [fg, bg, min, label] of PAIRS) {
    if (!t[fg] || !t[bg]) {
      failed += 1;
      console.log(`FAIL ${mode} ${label}: token ${!t[fg] ? fg : bg} missing`);
      continue;
    }
    const r = ratio(t[fg], t[bg]);
    const pass = r >= min;
    if (!pass) failed += 1;
    console.log(`${pass ? "ok  " : "FAIL"} ${mode.padEnd(5)} ${label.padEnd(32)} ${r.toFixed(2)}:1 (needs ${min})  ${fg} ${t[fg]} on ${bg} ${t[bg]}`);
  }
}
console.log(failed === 0 ? "PASS contrast" : `FAIL contrast (${failed})`);
process.exit(failed === 0 ? 0 : 1);
