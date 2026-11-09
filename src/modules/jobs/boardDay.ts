import { db } from "@/lib/db";
import { BOARDS } from "./boards";

/**
 * The daily yardstick per board (Phase M, M1; docs/boards/TDD.md §3.4): how many companies each board has, how many
 * open India jobs (tech, entry level), how many new India jobs arrived that day, and what users did with them. The
 * board order of Phase M is checked against two weeks of these rows, not against one snapshot.
 *
 * Days are UTC. Open counts are taken when the row is written; the flows (new India jobs, right swipes, submits) count
 * the whole day. Writing a day again overwrites its rows.
 */

const INDIA = ["india", "remote_india"];
const TECH = ["engineering", "data_ai"];
const ENTRY = ["intern", "entry"];

export type BoardDayRow = {
  day: Date;
  source: string;
  companies: number;
  active: number;
  open: number;
  empty: number;
  dead: number;
  openIndia: number;
  openIndiaTech: number;
  openIndiaEntry: number;
  newIndia: number;
  swipesRight: number;
  submitted: number;
};

/** Midnight UTC of the day a date falls on. */
export function utcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const count = (rows: Array<{ source: string; n: bigint | number }>) => new Map(rows.map((row) => [row.source, Number(row.n)]));

/** The rows of one day for the given boards (every board in `boards.ts` by default), computed, not written. */
export async function computeBoardDay(date: Date, sources: string[] = BOARDS.map((board) => board.source)): Promise<BoardDayRow[]> {
  const day = utcDay(date);
  const next = new Date(day.getTime() + 24 * 60 * 60 * 1000);
  const [companies, openIndia, tech, entry, newIndia, swipes, submitted] = await Promise.all([
    db.$queryRaw<Array<{ source: string; n: bigint }>>`
      SELECT source, COUNT(*) AS n FROM "Company" WHERE active AND source = ANY(${sources}) GROUP BY source`,
    db.$queryRaw<Array<{ source: string; n: bigint }>>`
      SELECT source, COUNT(*) AS n FROM "Job"
      WHERE "closedAt" IS NULL AND eligibility = ANY(${INDIA}) AND source = ANY(${sources}) GROUP BY source`,
    db.$queryRaw<Array<{ source: string; n: bigint }>>`
      SELECT source, COUNT(*) AS n FROM "Job"
      WHERE "closedAt" IS NULL AND eligibility = ANY(${INDIA}) AND function = ANY(${TECH}) AND source = ANY(${sources}) GROUP BY source`,
    db.$queryRaw<Array<{ source: string; n: bigint }>>`
      SELECT source, COUNT(*) AS n FROM "Job"
      WHERE "closedAt" IS NULL AND eligibility = ANY(${INDIA}) AND source = ANY(${sources})
        AND (seniority = ANY(${ENTRY}) OR "experienceMin" <= 2) GROUP BY source`,
    db.$queryRaw<Array<{ source: string; n: bigint }>>`
      SELECT source, COUNT(*) AS n FROM "Job"
      WHERE "firstSeenAt" >= ${day} AND "firstSeenAt" < ${next} AND eligibility = ANY(${INDIA}) AND source = ANY(${sources})
      GROUP BY source`,
    db.$queryRaw<Array<{ source: string; n: bigint }>>`
      SELECT j.source, COUNT(*) AS n FROM "Swipe" s JOIN "Job" j ON j.id = s."jobId"
      WHERE s.direction = 'right' AND s."createdAt" >= ${day} AND s."createdAt" < ${next} AND j.source = ANY(${sources})
      GROUP BY j.source`,
    db.$queryRaw<Array<{ source: string; n: bigint }>>`
      SELECT j.source, COUNT(*) AS n FROM "Application" a JOIN "Job" j ON j.id = a."jobId"
      WHERE a.status = 'submitted' AND a."submittedAt" >= ${day} AND a."submittedAt" < ${next} AND j.source = ANY(${sources})
      GROUP BY j.source`,
  ]);
  const by = { companies: count(companies), openIndia: count(openIndia), tech: count(tech), entry: count(entry), newIndia: count(newIndia), swipes: count(swipes), submitted: count(submitted) };
  return sources.map((source) => {
    const watched = by.companies.get(source) ?? 0;
    return {
      day,
      source,
      companies: watched,
      // Until M2 adds the watch tiers, every active company is read every run: all of them count as active.
      active: watched,
      open: 0,
      empty: 0,
      dead: 0,
      openIndia: by.openIndia.get(source) ?? 0,
      openIndiaTech: by.tech.get(source) ?? 0,
      openIndiaEntry: by.entry.get(source) ?? 0,
      newIndia: by.newIndia.get(source) ?? 0,
      swipesRight: by.swipes.get(source) ?? 0,
      submitted: by.submitted.get(source) ?? 0,
    };
  });
}

/** Computes and writes one day's rows (a second write of the same day replaces them). */
export async function writeBoardDay(date: Date = new Date(), sources?: string[]) {
  const rows = await computeBoardDay(date, sources);
  await db.$transaction(
    rows.map((row) => db.boardDay.upsert({ where: { day_source: { day: row.day, source: row.source } }, create: row, update: row })),
  );
  return rows;
}

/** The written rows between two days, both included, oldest first. */
export function boardDays(from: Date, to: Date, sources?: string[]) {
  return db.boardDay.findMany({
    where: { day: { gte: utcDay(from), lte: utcDay(to) }, ...(sources ? { source: { in: sources } } : {}) },
    orderBy: [{ day: "asc" }, { source: "asc" }],
  });
}
