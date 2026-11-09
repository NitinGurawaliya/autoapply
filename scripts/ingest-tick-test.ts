// Phase M, M2: one company's read in tick mode against a fake board: India-only storage (abroad kept only with
// keepAbroad), the probe skipping an unchanged board, list-only postings never overwriting stored text, closing,
// tiers and next read times, a board gone 3 times is dead, the tick's due list and its IngestRun counts.
// Uses a board name no real job has; every row it makes is removed. npx tsx scripts/ingest-tick-test.ts
import { db } from "../src/lib/db";
import { BOARDS, indiaEligible, type Board } from "../src/modules/jobs/boards";
import { INTERVAL_MS } from "../src/modules/jobs/cadence";
import { dueCompanies, ingestOne, startTickRun } from "../src/modules/jobs/ingest";
import type { FetchedJob } from "../src/modules/jobs/normalize";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const stamp = Date.now();
const SOURCE = `m2t${stamp}`;
const posted = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
const job = (id: string, location: string, description = `About ${id}`): FetchedJob => ({
  externalId: `${SOURCE}-${id}`, title: `Software Engineer ${id}`, location, description, applyUrl: `https://example.invalid/${id}`, postedAt: posted, raw: {},
});

// What the fake board lists per slug, how often it was read in full, and its probe's answer.
const listing = new Map<string, FetchedJob[] | Error>();
const reads = new Map<string, number>();
const probes = new Map<string, string>();
const fake: Board = {
  source: SOURCE as Board["source"],
  label: "M2 test",
  async fetch(slug, options) {
    reads.set(slug, (reads.get(slug) ?? 0) + 1);
    const listed = listing.get(slug) ?? [];
    if (listed instanceof Error) throw listed;
    // As Workday: postings already held come back from the list alone.
    return listed.map((item) => (options?.known?.has(item.externalId) && slug === "c" ? { ...item, description: "", listOnly: true } : item));
  },
  async probe(slug) {
    const hash = probes.get(slug);
    if (!hash) throw new Error("no probe");
    return hash;
  },
  stores: indiaEligible,
  formHost: /^example\.invalid$/,
  slugOf: (text) => text,
};

async function main() {
  BOARDS.push(fake);
  const make = (slug: string, keepAbroad = false) => db.company.create({ data: { source: SOURCE, slug, name: `M2 ${slug.toUpperCase()}`, keepAbroad, nextFetchAt: new Date(Date.now() - 60_000) } });
  const A = await make("a");
  const B = await make("b", true);
  const C = await make("c");
  const D = await make("d");
  const E = await make("e");
  const off = await db.company.create({ data: { source: SOURCE, slug: "off", name: "M2 OFF", active: false } });
  try {
    const due = await dueCompanies(100000);
    check("the due list holds the overdue active companies, not the inactive one", [A, B, C, D, E].every((c) => due.some((d) => d.id === c.id)) && !due.some((d) => d.id === off.id));

    listing.set("a", [job("a1", "Bengaluru, India"), job("a2", "London, United Kingdom")]);
    listing.set("b", [job("b1", "Bengaluru, India"), job("b2", "London, United Kingdom")]);
    const runId = await startTickRun(2);
    const before = Date.now();
    const a = await ingestOne(A.id, { runId });
    await ingestOne(B.id, { runId });
    const aJobs = await db.job.findMany({ where: { companyId: A.id } });
    const bJobs = await db.job.findMany({ where: { companyId: B.id } });
    check("a new company stores India-eligible jobs only", aJobs.length === 1 && aJobs[0].externalId.endsWith("a1"), aJobs.map((j) => j.externalId).join(","));
    check("a company kept from before Phase M stores abroad jobs too", bJobs.length === 2);
    const aRow = await db.company.findUniqueOrThrow({ where: { id: A.id } });
    const wait = aRow.nextFetchAt.getTime() - before;
    check("India listed: tier active, India count 1, read again in 3 h ±10%", a?.tier === "active" && aRow.indiaOpen === 1 && wait >= INTERVAL_MS.active * 0.89 && wait <= INTERVAL_MS.active * 1.11, `${aRow.tier} ${aRow.indiaOpen} ${Math.round(wait / 60000)} min`);
    const run = await db.ingestRun.findUniqueOrThrow({ where: { id: runId } });
    check("the tick's run adds each company's counts", run.companies === 2 && run.fetched === 4 && run.created === 3 && run.createdEligible === 2 && run.finishedAt !== null, JSON.stringify({ f: run.fetched, c: run.created, e: run.createdEligible }));

    // The probe: an unchanged list skips the full read.
    probes.set("a", "hash-1");
    await ingestOne(A.id);
    const readsAfterHash = reads.get("a");
    await ingestOne(A.id);
    const skipped = await db.company.findUniqueOrThrow({ where: { id: A.id } });
    check("a probe equal to the last list skips the full read", reads.get("a") === readsAfterHash && skipped.listHash === "hash-1" && skipped.tier === "active" && skipped.indiaOpen === 1, `reads ${reads.get("a")}`);
    probes.set("a", "hash-2");
    listing.set("a", [job("a1", "Bengaluru, India")]);
    await ingestOne(A.id);
    check("a changed probe reads in full again", reads.get("a") === (readsAfterHash ?? 0) + 1);

    // List-only postings (Workday's known ones) keep their stored text; one the board dropped is closed.
    listing.set("c", [job("c1", "Pune, India", "The real description"), job("c2", "Hyderabad, India")]);
    await ingestOne(C.id);
    const firstHash = (await db.job.findFirstOrThrow({ where: { externalId: `${SOURCE}-c1` } })).contentHash;
    listing.set("c", [job("c1", "Pune, India", "The real description")]);
    await ingestOne(C.id);
    const c1 = await db.job.findFirstOrThrow({ where: { externalId: `${SOURCE}-c1` } });
    const c2 = await db.job.findFirstOrThrow({ where: { externalId: `${SOURCE}-c2` } });
    check("a list-only posting keeps its stored description and hash", c1.description === "The real description" && c1.contentHash === firstHash && c1.closedAt === null);
    check("a posting the board no longer lists is closed", c2.closedAt !== null);

    // An empty board, and a board that is gone.
    listing.set("d", []);
    const d = await ingestOne(D.id);
    const dRow = await db.company.findUniqueOrThrow({ where: { id: D.id } });
    check("no openings: empty, read again in about 3 days", d?.tier === "empty" && dRow.emptySince !== null && dRow.nextFetchAt.getTime() - Date.now() > 2.6 * 24 * 3600 * 1000);
    listing.set("e", new Error(`${SOURCE} e 404`));
    for (let i = 0; i < 3; i += 1) await ingestOne(E.id);
    const eRow = await db.company.findUniqueOrThrow({ where: { id: E.id } });
    check("3 reads finding no board: dead, still active (watched monthly, not switched off)", eRow.tier === "dead" && eRow.notFoundFetches === 3 && eRow.active && eRow.lastError?.includes("404") === true, `${eRow.tier} ${eRow.notFoundFetches}`);
    check("an inactive company is not read", (await ingestOne(off.id)) === null);
    const dueAfter = await dueCompanies(100000);
    check("companies just read are no longer due", ![A, B, C, D, E].some((c) => dueAfter.some((x) => x.id === c.id)));
    await db.ingestRun.delete({ where: { id: runId } });
  } finally {
    await db.job.deleteMany({ where: { source: SOURCE } });
    await db.company.deleteMany({ where: { source: SOURCE } });
    BOARDS.splice(BOARDS.indexOf(fake), 1);
  }
  console.log(failed ? `FAIL ingest-tick-test: ${failed} failed` : "PASS ingest-tick-test");
  if (failed) process.exitCode = 1;
}
main().finally(() => db.$disconnect());
