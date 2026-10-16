// How Ashby applications end: sent, refused by Ashby's spam check, or failed for another reason, per day and overall,
// with the latest refusals. Read-only. npx tsx scripts/ashby-report.ts [days]
import { db } from "../src/lib/db";

async function main() {
  const days = Number(process.argv[2]) || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.$queryRaw<Array<{ id: string; status: string; error: string | null; createdAt: Date; company: string; title: string }>>`
    SELECT a.id, a.status, a.error, a."createdAt", c.name AS company, j.title
    FROM "Application" a JOIN "Job" j ON j.id = a."jobId" JOIN "Company" c ON c.id = j."companyId"
    WHERE j.source = 'ashby' AND a."createdAt" >= ${since}
    ORDER BY a."createdAt" DESC`;
  const kind = (row: { status: string; error: string | null }) =>
    row.status === "submitted" ? "sent" : /spam/i.test(row.error ?? "") ? "refused as spam" : /captcha/i.test(row.error ?? "") ? "captcha" : row.status === "failed" ? "failed (other)" : row.status;
  const total = new Map<string, number>();
  for (const row of rows) total.set(kind(row), (total.get(kind(row)) ?? 0) + 1);
  const ran = rows.filter((row) => ["sent", "refused as spam", "captcha", "failed (other)"].includes(kind(row))).length;
  console.log(`Ashby applications, last ${days} days: ${rows.length}`);
  for (const [name, count] of [...total].sort((a, b) => b[1] - a[1])) console.log(`  ${name.padEnd(16)} ${count}${ran && !["blocked", "needs_input", "queued", "filling", "inspecting", "cancelled"].includes(name) ? `  (${Math.round((100 * count) / ran)}% of runs that ended)` : ""}`);
  console.log("\nLatest:");
  for (const row of rows.slice(0, 15)) console.log(`  ${row.createdAt.toISOString().slice(0, 16)}  ${kind(row).padEnd(16)} ${row.company} · ${row.title.slice(0, 50)}${row.error && kind(row) === "failed (other)" ? `  — ${row.error.replace(/\s+/g, " ").slice(0, 80)}` : ""}`);
}
main().finally(() => db.$disconnect());
