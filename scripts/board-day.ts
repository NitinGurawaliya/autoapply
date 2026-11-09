// Phase M, M1: write (or rewrite) one UTC day's row per board in BoardDay, as the worker's 23:30 UTC cron does.
//   npx tsx scripts/board-day.ts               # today (UTC)
//   npx tsx scripts/board-day.ts --day 2026-11-08
import { db } from "../src/lib/db";
import { writeBoardDay } from "../src/modules/jobs";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const text = arg("--day");
  const day = text ? new Date(`${text}T12:00:00Z`) : new Date();
  if (Number.isNaN(day.getTime())) throw new Error(`not a day: ${text}`);
  const rows = await writeBoardDay(day);
  console.log(`BoardDay ${rows[0]?.day.toISOString().slice(0, 10)} written for ${rows.length} boards:`);
  console.table(rows.map((row) => ({ ...row, day: row.day.toISOString().slice(0, 10) })));
}
main().finally(() => db.$disconnect());
