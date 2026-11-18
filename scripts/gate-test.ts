// Phase P, P1: the pure part of the one gate (modules/jobs/gate.ts): trackOf and jobGate on hand-made jobs. No DB, no
// model. P3 adds the SQL mirror's agreement on 500 real jobs.
//   npx tsx scripts/gate-test.ts
import { jobGate, trackOf, type GateJob } from "../src/modules/jobs/gate";

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
check("the reading decides the field, not the title", rule(pass(read({ title: "Backend Engineer", roleFamily: "data_engineering" }), ["backend"])) === "field");
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
check("avoid intern leaves an employee job", rule(pass(read({}), ["backend"], ["intern", "contract", "commission_only"])) === "pass");

// mock
check("mock jobs always pass", rule(pass(read({ source: "mock", roleFamily: "non_tech", kind: "gig" }), ["backend"])) === "pass");

console.log(failed === 0 ? "PASS gate-test" : `FAIL gate-test (${failed} failed)`);
process.exitCode = failed === 0 ? 0 : 1;
