// W0 (docs/employers/TDD.md 10.1): a job from a signed-in source (Naukri) is never on a public page: not as a share
// page's job, not as a "similar job". Throwaway rows, deleted at the end. npx tsx scripts/public-sources-test.ts
import { db } from "../src/lib/db";
import { publicJob } from "../src/modules/jobs/public";
import { similarJobs } from "../src/modules/jobs/similar";

let failed = 0;
function ok(name: string, pass: boolean, detail = "") {
  if (!pass) failed += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

async function main() {
  const stamp = Date.now();
  const mock = await db.company.create({ data: { source: "mock", slug: `w0-mock-${stamp}`, name: "W0 Mock", active: false } });
  const naukri = await db.company.create({ data: { source: "naukri", slug: `w0-naukri-${stamp}`, name: "W0 Naukri", active: false } });
  const gh = await db.company.create({ data: { source: "greenhouse", slug: `w0-gh-${stamp}`, name: "W0 Greenhouse", active: false } });
  const now = new Date();
  const base = { location: "Bengaluru", country: "IN", remoteType: "onsite", description: "x", postedAt: now, fetchedAt: now, eligibility: "india", raw: {} };
  const own = await db.job.create({ data: { ...base, source: "mock", externalId: `w0-own-${stamp}`, companyId: mock.id, title: "W0 own job", applyUrl: "https://example.com/own" } });
  const nJob = await db.job.create({ data: { ...base, source: "naukri", externalId: `w0-n-${stamp}`, companyId: naukri.id, title: "W0 naukri job", applyUrl: "https://www.naukri.com/job-listings-w0" } });
  const gJob = await db.job.create({ data: { ...base, source: "greenhouse", externalId: `w0-g-${stamp}`, companyId: gh.id, title: "W0 greenhouse job", applyUrl: "https://boards.greenhouse.io/w0/jobs/1" } });
  try {
    ok("publicJob of a Naukri job is null", (await publicJob(nJob.id)) === null);
    ok("publicJob of a Greenhouse job is not", (await publicJob(gJob.id)) !== null);
    // The similar-jobs check needs an embedding: copy any real one onto the throwaway jobs.
    const [donor] = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Job" WHERE embedding IS NOT NULL AND source NOT IN ('mock', 'naukri') LIMIT 1`;
    if (!donor) {
      console.log("skip similarJobs check: no embedded job to copy");
    } else {
      await db.$executeRaw`UPDATE "Job" SET embedding = (SELECT embedding FROM "Job" WHERE id = ${donor.id}) WHERE id = ANY(${[own.id, nJob.id, gJob.id]}::text[])`;
      const similar = await similarJobs(own.id, 20);
      const ids = new Set(similar.map((job) => job.id));
      ok("similarJobs never returns the Naukri job", !ids.has(nJob.id));
      // Greenhouse is in APPLY_BOARDS, so the control job must come back or the check proves nothing.
      ok("similarJobs does return the Greenhouse control job", ids.has(gJob.id), `${similar.length} results`);
    }
  } finally {
    await db.job.deleteMany({ where: { id: { in: [own.id, nJob.id, gJob.id] } } });
    await db.company.deleteMany({ where: { id: { in: [mock.id, naukri.id, gh.id] } } });
  }
  console.log(failed === 0 ? "PASS public-sources-test" : `FAIL public-sources-test (${failed})`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
