// Throwaway recorder (4 Nov): every question the agent asks a user, as it happens, read-only. Appends one line per
// question to the log file given; runs until stopped. npx tsx scripts/_watch-asks.ts <log file>
import { appendFileSync } from "node:fs";
import { db } from "../src/lib/db";

const log = process.argv[2];
const ROUTINE = /^(All application fields|The form is filled|Waiting for|Keka did not accept the CAPTCHA)/;
let since = new Date(Date.now() - 15 * 60 * 1000);

async function tick() {
  const events = await db.$queryRaw<Array<{ at: Date; message: string; name: string | null; source: string; company: string; title: string; status: string; pending: unknown }>>`
    SELECT e."createdAt" at, e.message, u.name, j.source, c.name company, j.title, a.status, a."pendingQuestions" pending
    FROM "ApplicationEvent" e JOIN "Application" a ON a.id = e."applicationId" JOIN "User" u ON u.id = a."userId"
    JOIN "Job" j ON j.id = a."jobId" JOIN "Company" c ON c.id = j."companyId"
    WHERE e.type = 'ask_user' AND e."createdAt" > ${since} ORDER BY e."createdAt"`;
  for (const event of events) {
    since = event.at;
    if (ROUTINE.test(event.message)) continue;
    const questions = Array.isArray(event.pending) ? (event.pending as Array<{ label?: string; type?: string; options?: string[] }>).map((q) => `${(q.label ?? "").replace(/\s+/g, " ").slice(0, 120)} [${q.type}${q.options?.length ? `, ${q.options.length} options` : ""}]`) : [];
    const line = `${event.at.toISOString().slice(0, 19)}Z | ${event.name ?? "?"} | ${event.source} | ${event.company} | ${event.title.slice(0, 50)} | ${event.message.replace(/\s+/g, " ").slice(0, 120)} | ${questions.join(" ; ") || "(see the application page)"}\n`;
    appendFileSync(log, line);
  }
}

async function main() {
  appendFileSync(log, `# recording from ${new Date().toISOString()} (last 15 minutes included)\n`);
  for (;;) {
    await tick().catch((error) => appendFileSync(log, `# error: ${error instanceof Error ? error.message.slice(0, 120) : error}\n`));
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}
void main();
