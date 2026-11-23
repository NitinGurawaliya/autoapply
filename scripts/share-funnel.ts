// The share-link funnel (Phase U7, docs/share/TDD.md 4.7): visitors per step by the link's source (?s=), and what share
// of each step reached the next. Read-only.
// npx tsx scripts/share-funnel.ts [--days 7]
import { db } from "../src/lib/db";
import { FUNNEL_STEPS, funnelReport, type FunnelReport } from "../src/lib/funnel";

// The steps in the order a person goes through them; blocked is reported beside queued, not after it.
const PATH = ["view", "apply_tap", "signed_in", "resume_read", "profile_saved", "queued", "landed", "submitted"] as const;

export function printReport(report: FunnelReport) {
  const width = Math.max(8, ...report.rows.map((row) => row.source.length));
  console.log(`share links since ${report.since.toISOString().slice(0, 16).replace("T", " ")} UTC (visitors)`);
  console.log(["source".padEnd(width), ...FUNNEL_STEPS.map((step) => step.padStart(Math.max(7, step.length)))].join("  "));
  for (const row of report.rows) {
    console.log([row.source.padEnd(width), ...FUNNEL_STEPS.map((step) => String(row.counts[step]).padStart(Math.max(7, step.length)))].join("  "));
  }
  const all = report.rows.find((row) => row.source === "all")?.counts;
  if (!all) return;
  console.log("\nreached the next step (all sources)");
  for (let index = 1; index < PATH.length; index += 1) {
    const from = all[PATH[index - 1]];
    const to = all[PATH[index]];
    console.log(`  ${PATH[index - 1]} → ${PATH[index]}: ${to}/${from}${from > 0 ? ` (${Math.round((to / from) * 100)}%)` : ""}`);
  }
  console.log(`  stopped by a rule instead of queued: ${all.blocked}`);
  console.log("  (someone already signed in with a profile skips signed_in to profile_saved, so a later step can exceed an earlier one)");
}

async function main() {
  const at = process.argv.indexOf("--days");
  const days = at >= 0 ? Math.max(1, Number(process.argv[at + 1]) || 7) : 7;
  printReport(await funnelReport(new Date(Date.now() - days * 86_400_000)));
  await db.$disconnect();
}

if (process.argv[1]?.includes("share-funnel.ts")) {
  main().catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
}
