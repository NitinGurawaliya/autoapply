// Phase P, P1: job reading (modules/jobs/reading.ts) and its staleness trigger (migration 20261119090000_job_reading).
// (1) the code checks on hand-made answers: an invented line is dropped, and a family, kind or flag without a line with
// it; (2) on a throwaway mock job: a new job is not current, a written reading is, a location change keeps it current,
// a description change stales it, and a write after the text changed is skipped; (3) one model batch on three
// hand-written postings. Removes its company and job at the end.
//   npx tsx scripts/reading-test.ts [--no-model]
import { createHash } from "node:crypto";
import { db } from "../src/lib/db";
import { answerSchema, checkReading, readBatch, writeReadings, type Reading } from "../src/modules/jobs/reading";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const BACKEND = {
  title: "Backend Engineer (Node.js)",
  description:
    "We are a fintech startup in Bengaluru. You will build and run the APIs behind our payments app. Requirements: 2+ years of experience with Node.js and PostgreSQL. Experience designing REST APIs and working with message queues. This is a full-time role.",
};
const GIG = {
  title: "AI Training - Python Coder (Remote, Freelance)",
  description:
    "Join our platform and get paid per task to evaluate and improve AI model responses to coding questions. Work whenever you want, paid hourly for each task you complete. You need strong Python skills and good written English.",
};
const CONTRACT = {
  title: "Data Engineer - 6 month contract",
  description:
    "This is a 6-month fixed-term contract with a possible extension. You will build ETL pipelines in Airflow and Spark on AWS. Must have 3+ years of data engineering experience and strong SQL.",
};

function pureChecks() {
  const answer = {
    n: 0,
    roleFamily: "backend" as const,
    kind: "contract" as const,
    flags: ["commission_only" as const],
    summary: "A backend role building payment APIs.",
    evidence: [
      { for: "roleFamily" as const, line: "You will build and run the APIs behind our payments app." },
      { for: "kind" as const, line: "This is a 12-month contract." },
      { for: "commission_only" as const, line: "Pay is commission only." },
    ],
    requirements: ["2+ years of experience with Node.js and PostgreSQL.", "Must know Kubernetes deeply.", "Experience   designing REST APIs"],
  };
  const reading = checkReading(BACKEND, answer);
  check("a line from the posting is kept", reading.roleFamily === "backend" && reading.evidence.length === 1);
  check("a kind whose line is invented is dropped", reading.kind === null);
  check("a flag whose line is invented is dropped", reading.flags.length === 0);
  check(
    "requirement lines: real ones kept (spacing ignored), an invented one dropped",
    reading.requirements.length === 2 && !reading.requirements.some((line) => line.includes("Kubernetes")),
    JSON.stringify(reading.requirements),
  );
  check("dropped lines are counted", reading.dropped === 3, String(reading.dropped));
  const noLine = checkReading(BACKEND, { ...answer, roleFamily: "frontend", kind: "employee", flags: [], evidence: [] });
  check("a family without a line (and not the title's) is stored as null; employee needs none", noLine.roleFamily === null && noLine.kind === "employee");
  const curly = checkReading(
    { title: "SRE", description: "You’ll own our on‑call rotation — and the uptime." },
    { ...answer, roleFamily: "devops", kind: "employee", flags: [], evidence: [{ for: "roleFamily", line: "You'll own our on-call rotation" }], requirements: [] },
  );
  check("curly quotes and odd dashes match their plain forms", curly.roleFamily === "devops");
  const entity = checkReading(
    { title: "SAP ABAP Developer", description: "SAP S/4 HANA ABAP Developer With 6 to 8&#xa0;years of SAP S/4 HANA Development experience &amp; more." },
    { ...answer, roleFamily: "software", kind: "employee", flags: [], evidence: [{ for: "roleFamily", line: "SAP S/4 HANA ABAP Developer With 6 to 8 years of SAP S/4 HANA Development experience & more." }], requirements: [] },
  );
  check("HTML entities in the posting match the decoded line", entity.roleFamily === "software");
  const byTitle = checkReading(
    { title: "Junior Executive, Maintenance", description: "Responsible for preventive maintenance of production equipment and machines." },
    { ...answer, roleFamily: "non_tech", kind: "employee", flags: [], evidence: [{ for: "roleFamily", line: "Overall responsible for the plant layout." }], requirements: [] },
  );
  check("a field whose line fails is kept when the title says the same", byTitle.roleFamily === "non_tech" && byTitle.evidence[0]?.line === "Junior Executive, Maintenance");
  const notByTitle = checkReading(
    { title: "Lead Engineer", description: "Lead our integrations team." },
    { ...answer, roleFamily: "fullstack", kind: "employee", flags: [], evidence: [{ for: "roleFamily", line: "As the Lead full stack Engineer" }], requirements: [] },
  );
  check("a field whose line fails and the title does not say stays null", notByTitle.roleFamily === null);
  const tiny = checkReading(BACKEND, { ...answer, roleFamily: "frontend", kind: "employee", flags: [], evidence: [{ for: "roleFamily", line: "the" }], requirements: [] });
  check("a line too short to show anything is dropped", tiny.roleFamily === null);
  const soft = checkReading(
    {
      title: "Java Developer",
      description:
        "Excellent communication and interpersonal skills. 5+ years of Java and strong communication skills. Willing to work in rotational shifts. Bachelor's degree in Computer Science. Must be a team player.",
    },
    {
      ...answer,
      roleFamily: "backend",
      kind: "employee",
      flags: [],
      evidence: [],
      requirements: ["Excellent communication and interpersonal skills.", "5+ years of Java and strong communication skills.", "Willing to work in rotational shifts.", "Bachelor's degree in Computer Science.", "Must be a team player."],
    },
  );
  check(
    "soft-skill-only and logistics requirement lines are dropped; a line with years or a degree is kept",
    JSON.stringify(soft.requirements) === JSON.stringify(["5+ years of Java and strong communication skills.", "Bachelor's degree in Computer Science."]),
    JSON.stringify(soft.requirements),
  );
  const stray = answerSchema.safeParse({
    results: [
      { n: 0, roleFamily: "product", kind: "full_time", flags: ["remote", "paid_task"], summary: "x", evidence: [{ for: "summary", line: "abc" }], requirements: [] },
      { n: 1, roleFamily: "backend", kind: "employee", flags: [], summary: "y", evidence: [], requirements: [] },
    ],
  });
  const shaped = answerSchema.safeParse({
    results: [{ n: 0, roleFamily: "backend", kind: "employee", flags: [], summary: "x", evidence: [], requirements: [{ line: "2+ years of Node.js" }, "A degree in CS", 7, { text: "x" }] }],
  });
  check(
    "requirement items given as {line} objects are read as lines; other junk drops alone",
    shaped.success && JSON.stringify(shaped.data.results[0].requirements) === JSON.stringify(["2+ years of Node.js", "A degree in CS"]),
    shaped.success ? JSON.stringify(shaped.data.results[0].requirements) : "parse failed",
  );
  const strayFirst = stray.success ? stray.data.results[0] : null;
  check(
    "a value outside the enums is read as null, not a failed batch",
    stray.success && strayFirst?.roleFamily === null && strayFirst.kind === null && strayFirst.evidence[0]?.for === null && stray.data.results[1].roleFamily === "backend",
  );
}

const md5 = (title: string, description: string) => createHash("md5").update(`${title}\n${description}`).digest("hex");
const READING: Reading = {
  roleFamily: "backend",
  kind: "employee",
  flags: [],
  summary: "A backend job.",
  evidence: [{ for: "roleFamily", line: "build and run the APIs" }],
  requirements: [],
  dropped: 0,
};

async function dbChecks() {
  const stamp = Date.now();
  const company = await db.company.create({ data: { source: "mock", slug: `reading-test-${stamp}`, name: "Reading Test Co" } });
  try {
    const job = await db.job.create({
      data: {
        source: "mock", externalId: `reading-test-${stamp}`, companyId: company.id, title: BACKEND.title, location: "Bengaluru", country: "IN", remoteType: "onsite",
        description: BACKEND.description, applyUrl: "http://localhost/mock", postedAt: new Date(), fetchedAt: new Date(), raw: {},
      },
    });
    const state = () => db.job.findUniqueOrThrow({ where: { id: job.id }, select: { readingCurrent: true, roleFamily: true, readAt: true, reading: true } });
    check("a new job has no current reading", (await state()).readingCurrent === false);
    const written = await writeReadings([{ id: job.id, hash: md5(BACKEND.title, BACKEND.description), reading: READING }]);
    const after = await state();
    check("a reading of the job's text is written and current", written === 1 && after.readingCurrent && after.roleFamily === "backend" && after.readAt !== null);
    await db.job.update({ where: { id: job.id }, data: { location: "Pune", fetchedAt: new Date() } });
    check("a location change keeps the reading current", (await state()).readingCurrent === true);
    await db.job.update({ where: { id: job.id }, data: { title: BACKEND.title, description: BACKEND.description, location: "Hyderabad" } });
    check("rewriting the same title and description keeps it current (the value check)", (await state()).readingCurrent === true);
    await db.job.update({ where: { id: job.id }, data: { description: `${BACKEND.description} Now hybrid.` } });
    const stale = await state();
    check("a description change stales the reading (kept, not current)", stale.readingCurrent === false && stale.reading !== null);
    const late = await writeReadings([{ id: job.id, hash: md5(BACKEND.title, BACKEND.description), reading: { ...READING, roleFamily: "frontend" } }]);
    const kept = await state();
    check("a write of the old text after the change is skipped", late === 0 && kept.readingCurrent === false && kept.roleFamily === "backend");
    const newTitle = "Senior Backend Engineer (Node.js)";
    await db.job.update({ where: { id: job.id }, data: { title: newTitle } });
    const again = await writeReadings([{ id: job.id, hash: md5(newTitle, `${BACKEND.description} Now hybrid.`), reading: READING }]);
    check("a write of the current text lands", again === 1 && (await state()).readingCurrent === true);
    await db.job.update({ where: { id: job.id }, data: { title: "Staff Backend Engineer (Node.js)" } });
    check("a title change stales the reading", (await state()).readingCurrent === false);
    // 20 Nov: the years a requirement line asks for fill experienceMin when ingest found none, and never replace it.
    const years = () => db.job.findUniqueOrThrow({ where: { id: job.id }, select: { experienceMin: true } }).then((row) => row.experienceMin);
    await db.job.update({ where: { id: job.id }, data: { experienceMin: null } });
    const yearsHash = md5("Staff Backend Engineer (Node.js)", `${BACKEND.description} Now hybrid.`);
    await writeReadings([{ id: job.id, hash: yearsHash, reading: { ...READING, requirements: ["5+ years in backend development with Go."] } }]);
    check("a requirement line's years fill an empty experienceMin", (await years()) === 5, String(await years()));
    await db.job.update({ where: { id: job.id }, data: { experienceMin: 2 } });
    await writeReadings([{ id: job.id, hash: yearsHash, reading: { ...READING, requirements: ["7+ years designing distributed systems."] } }]);
    check("…but never replace years ingest found", (await years()) === 2, String(await years()));
  } finally {
    await db.company.delete({ where: { id: company.id } });
  }
}

async function modelChecks() {
  const readings = await readBatch([BACKEND, GIG, CONTRACT]);
  const [backend, gig, contract] = [0, 1, 2].map((n) => readings.get(n));
  console.log(JSON.stringify([backend, gig, contract], null, 1));
  check("the model reads all three", Boolean(backend && gig && contract));
  check("the backend posting: backend, employee, with lines", backend?.roleFamily === "backend" && backend.kind === "employee" && backend.requirements.length >= 2);
  check("the AI-training posting: a gig or a paid task", gig?.kind === "gig" || gig?.kind === "task" || Boolean(gig?.flags.includes("paid_task")));
  check("the contract posting: data engineering, contract", contract?.roleFamily === "data_engineering" && contract.kind === "contract");
}

async function main() {
  pureChecks();
  await dbChecks();
  if (!process.argv.includes("--no-model")) await modelChecks();
  console.log(failed === 0 ? "PASS reading-test" : `FAIL reading-test (${failed} failed)`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().finally(() => db.$disconnect());
