import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * For uptime checks and the deploy (no sign-in, nothing personal): the database answers, a worker has beaten in the
 * last 5 minutes (src/worker/index.ts), and when ingest and discovery last ran. 200 when the database and a worker are
 * up, 503 otherwise, so a monitor can alert on a stopped worker (no jobs, no applications, no alerts).
 */
export async function GET() {
  try {
    const [beats, lastIngest, lastDiscovery, companies] = await Promise.all([
      // Workers seen in the last day: old hosts (a laptop test, a stopped container) are history, not the fleet.
      db.workerBeat.findMany({ where: { beatAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, orderBy: { beatAt: "desc" }, take: 5 }),
      db.ingestRun.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true, finishedAt: true, companies: true, failed: true, created: true, createdEligible: true } }),
      // Discovery's own names (the model, or the crawl index for Ashby), not re-checks of a list.
      db.discoveryCandidate.findFirst({ where: { from: { in: ["model", "crawl"] } }, orderBy: { checkedAt: "desc" }, select: { checkedAt: true } }),
      db.company.groupBy({ by: ["source"], where: { active: true, source: { not: "mock" } }, _count: true }),
    ]);
    const workerUp = beats.some((beat) => Date.now() - beat.beatAt.getTime() < 5 * 60 * 1000);
    const body = {
      ok: workerUp,
      database: "up",
      worker: workerUp ? "up" : "down",
      workers: beats.map((beat) => ({ host: beat.id, lastBeat: beat.beatAt, since: beat.startedAt })),
      lastIngest,
      lastDiscovery: lastDiscovery?.checkedAt ?? null,
      activeCompanies: Object.fromEntries(companies.map((row) => [row.source, row._count])),
      activeGreenhouseCompanies: companies.find((row) => row.source === "greenhouse")?._count ?? 0,
    };
    return NextResponse.json(body, { status: workerUp ? 200 : 503 });
  } catch {
    return NextResponse.json({ ok: false, database: "down" }, { status: 503 });
  }
}
