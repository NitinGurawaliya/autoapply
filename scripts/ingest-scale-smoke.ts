// Phase M, M2: does tick mode keep up at 20,000 companies? A simulation of the scheduler over two days, in-process and
// offline: the real tier intervals and jitter (cadence.ts), the tick every 5 minutes sending at most INGEST_TICK_BATCH
// due companies, one worker taking INGEST_CONCURRENCY reads at once and at most INGEST_PER_HOST of one board at once, read
// times drawn per board. Two starts: steady (each company's next read spread over its interval) and cold (all 20,000 due
// at once, as right after a big seed import). Prints requests a day per board, the most overdue read, and whether the
// per-board cap was ever broken. It checks the schedule, not the boards: no request leaves the machine.
//   npx tsx scripts/ingest-scale-smoke.ts [--companies 20000] [--batch 2000]
import { INTERVAL_MS, nextFetchAt, type Tier } from "../src/modules/jobs/cadence";

function arg(name: string, fallback: number) {
  const at = process.argv.indexOf(name);
  const value = at >= 0 ? Number(process.argv[at + 1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const COMPANIES = arg("--companies", 20000);
const BATCH = arg("--batch", Number(process.env.INGEST_TICK_BATCH) || 2000);
const CONCURRENCY = arg("--concurrency", Number(process.env.INGEST_CONCURRENCY) || 8);
const PER_HOST = arg("--per-host", Number(process.env.INGEST_PER_HOST) || 4);
const TICK_S = 300;
const DAY_S = 24 * 3600;

// Board shares of the companies (the open lists, docs/boards/TDD.md fact 16) and seconds per read (Workday reads
// several list pages; Greenhouse mostly a cheap probe).
const BOARDS: Array<{ board: string; share: number; readS: number }> = [
  { board: "greenhouse", share: 0.4, readS: 0.7 },
  { board: "workday", share: 0.15, readS: 2.5 },
  { board: "ashby", share: 0.15, readS: 0.8 },
  { board: "lever", share: 0.1, readS: 0.8 },
  { board: "smartrecruiters", share: 0.1, readS: 1.5 },
  { board: "keka", share: 0.05, readS: 0.8 },
  { board: "zohorecruit", share: 0.05, readS: 1.0 },
];
// Tier shares (TDD §4.8 estimate; M1 measures the real ones).
const TIER_SHARE: Array<[Tier, number]> = [["active", 0.1], ["open", 0.6], ["empty", 0.2], ["dead", 0.1]];

// A seeded random, so two runs print the same numbers.
let seed = 42;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(items: Array<[T, number]>) => {
  let r = random();
  for (const [item, share] of items) if ((r -= share) <= 0) return item;
  return items[items.length - 1][0];
};

type Company = { id: number; board: string; tier: Tier; next: number; queued: boolean; running: boolean };

function simulate(start: "steady" | "cold") {
  seed = 42;
  const companies: Company[] = Array.from({ length: COMPANIES }, (_, id) => {
    const board = pick(BOARDS.map((b) => [b.board, b.share] as [string, number]));
    const tier = pick(TIER_SHARE);
    const next = start === "cold" ? 0 : Math.floor(random() * (INTERVAL_MS[tier] / 1000));
    return { id, board, tier, next, queued: false, running: false };
  });
  const readS = new Map(BOARDS.map((b) => [b.board, b.readS]));
  const queues = new Map<string, Company[]>(BOARDS.map((b) => [b.board, []]));
  const runningPerBoard = new Map<string, number>(BOARDS.map((b) => [b.board, 0]));
  const finishing: Array<{ at: number; company: Company }> = [];
  let running = 0;
  let maxPerBoard = 0;
  let maxRunning = 0;
  const reads = new Map<string, number[]>(BOARDS.map((b) => [b.board, [0, 0]]));
  let worstLateS = 0;
  let worstLateDay2S = 0;
  const DAYS = 2;

  for (let t = 0; t < DAYS * DAY_S; t += 1) {
    // Reads that end now: the company's next read time comes from its tier (cadence.ts nextFetchAt).
    for (let i = finishing.length - 1; i >= 0; i -= 1) {
      if (finishing[i].at > t) continue;
      const { company } = finishing[i];
      finishing.splice(i, 1);
      company.running = false;
      running -= 1;
      runningPerBoard.set(company.board, runningPerBoard.get(company.board)! - 1);
      company.next = Math.round(nextFetchAt(company.tier, 0, new Date(t * 1000), random).getTime() / 1000);
    }
    // The tick: due companies, most overdue first, at most BATCH, none already waiting or running.
    if (t % TICK_S === 0) {
      const due = companies.filter((c) => c.next <= t && !c.queued && !c.running).sort((a, b) => a.next - b.next).slice(0, BATCH);
      for (const company of due) {
        company.queued = true;
        queues.get(company.board)!.push(company);
      }
    }
    // The worker: up to CONCURRENCY reads, at most PER_HOST of one board, oldest first within a board.
    for (const board of BOARDS) {
      const queue = queues.get(board.board)!;
      while (queue.length && running < CONCURRENCY && runningPerBoard.get(board.board)! < PER_HOST) {
        const company = queue.shift()!;
        company.queued = false;
        company.running = true;
        running += 1;
        runningPerBoard.set(board.board, runningPerBoard.get(board.board)! + 1);
        maxPerBoard = Math.max(maxPerBoard, runningPerBoard.get(board.board)!);
        maxRunning = Math.max(maxRunning, running);
        const late = t - company.next;
        worstLateS = Math.max(worstLateS, late);
        if (t >= DAY_S) worstLateDay2S = Math.max(worstLateDay2S, late);
        reads.get(board.board)![t < DAY_S ? 0 : 1] += 1;
        const duration = Math.max(1, Math.round(readS.get(board.board)! * (0.5 + random())));
        finishing.push({ at: t + duration, company });
      }
    }
  }
  return { reads, maxPerBoard, maxRunning, worstLateS, worstLateDay2S };
}

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

console.log(`ingest-scale-smoke: ${COMPANIES} companies, tick every ${TICK_S / 60} min, batch ${BATCH}, ${CONCURRENCY} reads at once, ${PER_HOST} per board`);
for (const start of ["steady", "cold"] as const) {
  const result = simulate(start);
  const perDay = [...result.reads.entries()].map(([board, [, day2]]) => ({ board, readsDay2: day2 }));
  const total = perDay.reduce((sum, row) => sum + row.readsDay2, 0);
  console.log(`\n${start} start: reads on day 2 (steady state) per board:`);
  console.table(perDay);
  console.log(`  all boards: ${total} reads a day (${(total / DAY_S).toFixed(2)}/s); most overdue read ${Math.round(result.worstLateS / 60)} min overall, ${Math.round(result.worstLateDay2S / 60)} min on day 2; at most ${result.maxRunning} at once, ${result.maxPerBoard} of one board`);
  check(`${start}: the per-board cap was never broken`, result.maxPerBoard <= PER_HOST && result.maxRunning <= CONCURRENCY);
  check(`${start}: on day 2 no due company waited an hour`, result.worstLateDay2S < 3600, `${Math.round(result.worstLateDay2S / 60)} min`);
  if (start === "cold") check("cold: all of them read for the first time within 1 hour", result.worstLateS < 3600, `${Math.round(result.worstLateS / 60)} min`);
}
console.log(failed ? `FAIL ingest-scale-smoke: ${failed} failed` : "PASS ingest-scale-smoke");
if (failed) process.exitCode = 1;
