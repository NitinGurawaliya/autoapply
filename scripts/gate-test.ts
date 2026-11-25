// Phase P: the one gate (modules/jobs/gate.ts). (1) P1: trackOf and jobGate on hand-made jobs, with P3's field rule
// (title AND reading). (2) P3: the SQL mirror (gateSql, what feedRows filters with) gives jobGate's answer on 500 real
// jobs under several track and avoid sets. Reads only; no model.
//   npx tsx scripts/gate-test.ts [--no-db]
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db";
import { gateSql, jobGate, titleTrack, trackOf, type GateJob } from "../src/modules/jobs/gate";
import { APPLY_BOARDS } from "../src/modules/jobs/pool";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const job = (over: Partial<GateJob>): GateJob => ({ source: "greenhouse", title: "Backend Engineer", track: "backend", ...over });
const read = (over: Partial<GateJob>) => job({ readingCurrent: true, roleFamily: "backend", kind: "employee", flags: [], ...over });
const pass = (j: GateJob, tracks: string[] | null, avoid: string[] = [], field = true) => jobGate(j, { tracks, avoid }, { field });
const rule = (r: ReturnType<typeof jobGate>) => (r.pass ? "pass" : r.rule);

// trackOf
check("no reading: the title's stored track", trackOf(job({})) === "backend");
check("no stored track: the title decides", trackOf(job({ track: undefined, title: "Senior Frontend Developer" })) === "frontend");
check("a non-tech title is non_tech", trackOf(job({ track: null, title: "Account Executive, Enterprise" })) === "non_tech");
check("a current reading decides over the title", trackOf(read({ title: "Software Engineer", track: "software", roleFamily: "ml_ai" })) === "ml_ai");
check("a stale reading is ignored", trackOf(job({ readingCurrent: false, roleFamily: "non_tech" })) === "backend");
check("a current reading without a family falls back to the title", trackOf(read({ roleFamily: null })) === "backend");
check("a reading can say a tech-sounding title is non_tech", trackOf(read({ title: "Trainer - Python", track: "backend", roleFamily: "non_tech" })) === "non_tech");

// the field part
check("own track passes", rule(pass(read({}), ["backend"])) === "pass");
check("another track fails the field", rule(pass(read({ roleFamily: "frontend" }), ["backend"])) === "field");
check("title AND reading: a reading outside the tracks takes the job out", rule(pass(read({ title: "Backend Engineer", roleFamily: "data_engineering" }), ["backend"])) === "field");
check("title AND reading: a reading in the tracks cannot put a job in", rule(pass(read({ title: "Frontend Engineer", track: "frontend", roleFamily: "backend" }), ["backend"])) === "field");
check("title AND reading: title and reading both in the tracks pass", rule(pass(read({ title: "Software Engineer", track: "software", roleFamily: "ml_ai" }), ["ml_ai", "software"])) === "pass");
check("title AND reading: a stale reading leaves the title alone deciding", rule(pass(job({ readingCurrent: false, roleFamily: "data_engineering" }), ["backend"])) === "pass");
check("title AND reading: a current reading without a family leaves the title deciding", rule(pass(read({ roleFamily: null }), ["backend"])) === "pass");
check("titleTrack ignores the reading", titleTrack(read({ roleFamily: "ml_ai" })) === "backend");
check("no tracks skips the field part", rule(pass(read({ roleFamily: "frontend" }), null)) === "pass");
check("field: false skips the field part (swipe check)", rule(pass(read({ roleFamily: "frontend" }), ["backend"], [], false)) === "pass");
check("a title with no track fails the field", rule(pass(job({ track: null, title: "Technician" }), ["backend"])) !== "pass");

// always out
check("non_tech is out even with field: false", rule(pass(read({ roleFamily: "non_tech" }), null, [], false)) === "non_tech");
check("a gig is out", rule(pass(read({ kind: "gig" }), ["backend"])) === "gig");
check("a task is out", rule(pass(read({ kind: "task" }), ["backend"])) === "task");
check("a paid task is out", rule(pass(read({ flags: ["paid_task"] }), ["backend"], [], false)) === "paid_task");
check("a stale reading's kind does not count", rule(pass(job({ readingCurrent: false, kind: "gig", flags: ["paid_task"] }), ["backend"])) === "pass");

// avoids
check("contract passes without the avoid", rule(pass(read({ kind: "contract" }), ["backend"])) === "pass");
check("avoid contract removes contract", rule(pass(read({ kind: "contract" }), ["backend"], ["contract"])) === "avoid_contract");
check("avoid intern removes internships", rule(pass(read({ kind: "intern" }), ["backend"], ["intern"])) === "avoid_intern");
check("avoid commission_only removes the flag", rule(pass(read({ flags: ["commission_only"] }), ["backend"], ["commission_only"], false)) === "avoid_commission_only");
// Until a job is read, the title's intern level stands in for the reading's kind (24 Nov: unread "AI Intern" reached the feed).
check("avoid intern removes an unread internship by its title level", rule(pass(job({ seniority: "intern" }), ["backend"], ["intern"])) === "avoid_intern");
check("an unread internship stays without the chip", rule(pass(job({ seniority: "intern" }), ["backend"], [])) === "pass");
check("a read job's kind wins over the title level", rule(pass({ ...read({}), seniority: "intern" }, ["backend"], ["intern"])) === "pass");
check("avoid intern leaves an employee job", rule(pass(read({}), ["backend"], ["intern", "contract", "commission_only"])) === "pass");

// mock
check("mock jobs always pass", rule(pass(read({ source: "mock", roleFamily: "non_tech", kind: "gig" }), ["backend"])) === "pass");

// (2) The SQL mirror on real jobs: the feed's pool (open, on an apply board, India-eligible), 350 at random plus up to
// 150 whose current reading removes or limits them (non_tech, gig, task, a flag, a kind other than employee), so every
// rule is exercised. The same ids, through jobGate in JS and gateSql in Postgres, must agree under each set.
type Row = GateJob & { id: string; function: string | null };
const SETS: Array<{ name: string; tracks: string[] | null; avoid: string[] }> = [
  { name: "no tracks", tracks: null, avoid: [] },
  { name: "web developer", tracks: ["fullstack", "frontend", "backend", "software"], avoid: [] },
  { name: "data and ML", tracks: ["ml_ai", "data_science", "data_engineering"], avoid: [] },
  { name: "devops, every avoid", tracks: ["devops", "security", "software"], avoid: ["contract", "intern", "commission_only"] },
  { name: "web developer, every avoid", tracks: ["fullstack", "frontend", "backend", "software"], avoid: ["contract", "intern", "commission_only"] },
];

async function mirror() {
  const pool = (a: string) => Prisma.sql`${Prisma.raw(a)}."closedAt" IS NULL AND ${Prisma.raw(a)}.source = ANY(${[...APPLY_BOARDS]}::text[]) AND ${Prisma.raw(a)}.eligibility IN ('india', 'remote_india')`;
  const sampled = await db.$queryRaw<Row[]>`
    (SELECT j.id, j.source, j.title, j.track, j.function, j."roleFamily", j.kind, j.flags, j."readingCurrent", j.seniority FROM "Job" j
     WHERE ${pool("j")} ORDER BY md5(j.id || 'p3') LIMIT 350)
    UNION
    (SELECT j.id, j.source, j.title, j.track, j.function, j."roleFamily", j.kind, j.flags, j."readingCurrent", j.seniority FROM "Job" j
     WHERE ${pool("j")} AND j."readingCurrent" AND (j."roleFamily" = 'non_tech' OR coalesce(j.kind, 'employee') <> 'employee' OR cardinality(j.flags) > 0)
       AND j.id <> ALL(SELECT r.id FROM "Job" r WHERE ${pool("r")} ORDER BY md5(r.id || 'p3') LIMIT 350)
     ORDER BY md5(j.id || 'p3b') LIMIT 150)`;
  const ids = sampled.map((row) => row.id);
  const read = sampled.filter((row) => row.readingCurrent).length;
  const unclassified = sampled.filter((row) => !row.track && !row.function).length;
  check("500 real jobs sampled", sampled.length >= 480, `${sampled.length} jobs, ${read} with a current reading, ${unclassified} never classified`);
  for (const set of SETS) {
    const sql = await db.$queryRaw<Array<{ id: string; pass: boolean }>>`
      SELECT j.id, ${gateSql({ tracks: set.tracks, avoid: set.avoid })} AS pass FROM "Job" j WHERE j.id = ANY(${ids}::text[])`;
    const bySql = new Map(sql.map((row) => [row.id, row.pass]));
    const differ = sampled.filter((row) => jobGate(row, { tracks: set.tracks, avoid: set.avoid }, { field: true }).pass !== bySql.get(row.id));
    const passed = sampled.filter((row) => bySql.get(row.id)).length;
    check(
      `JS and SQL agree: ${set.name}`,
      differ.length === 0,
      `${passed} of ${sampled.length} pass${differ.length ? `; differ: ${differ.slice(0, 3).map((row) => `${row.id} ${row.title} track=${row.track} fn=${row.function} read=${row.readingCurrent}/${row.roleFamily}/${row.kind}/${row.flags?.join("+")}`).join(" | ")}` : ""}`,
    );
  }
}

async function main() {
  if (!process.argv.includes("--no-db")) await mirror();
  console.log(failed === 0 ? "PASS gate-test" : `FAIL gate-test (${failed} failed)`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().finally(() => db.$disconnect());
