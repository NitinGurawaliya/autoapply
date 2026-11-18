// M21: which recurring jobs a worker keeps, from its env (src/worker/schedule.ts schedulePlan). "off" hands ingest,
// discovery and the board day to the GitHub Actions schedule (.github/workflows/jobs.yml). Offline, no database.
// npx tsx scripts/schedule-plan-test.ts
import { DEFAULT_BOARD_DAY_CRON, DEFAULT_DISCOVER_CRON, DEFAULT_INGEST_CRON, DEFAULT_INGEST_TICK_CRON, schedulePlan } from "../src/worker/schedule";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` (${detail})` : ""}`);
}

const plain = schedulePlan({});
check("no env: the run-mode ingest, discovery and board day at their defaults", plain.mode === "run" && plain.ingest === DEFAULT_INGEST_CRON && plain.tick === null && plain.discover === DEFAULT_DISCOVER_CRON && plain.boardDay === DEFAULT_BOARD_DAY_CRON, JSON.stringify(plain));
const tick = schedulePlan({ INGEST_MODE: "tick" });
check("tick: the tick every 5 minutes, no run-mode ingest", tick.tick === DEFAULT_INGEST_TICK_CRON && tick.ingest === null, JSON.stringify(tick));
const off = schedulePlan({ INGEST_MODE: "off", DISCOVER_CRON: "off", BOARD_DAY_CRON: "off" });
check("all off (GitHub Actions runs them): no ingest of either kind, no discovery, no board day", off.mode === "off" && off.ingest === null && off.tick === null && off.discover === null && off.boardDay === null, JSON.stringify(off));
const some = schedulePlan({ INGEST_MODE: "tick", DISCOVER_CRON: " off " });
check("one switch at a time: discovery off, the tick kept", some.tick === DEFAULT_INGEST_TICK_CRON && some.discover === null && some.boardDay === DEFAULT_BOARD_DAY_CRON, JSON.stringify(some));
check("a cron of its own is kept", schedulePlan({ DISCOVER_CRON: "0 2 * * *" }).discover === "0 2 * * *");
check("an unknown mode is the run mode, never off by accident", schedulePlan({ INGEST_MODE: "Off-ish" }).mode === "run");

console.log(failed === 0 ? "PASS schedule-plan" : `FAIL schedule-plan (${failed})`);
process.exit(failed === 0 ? 0 : 1);
