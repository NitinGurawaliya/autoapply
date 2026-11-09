// Phase M, M1: the BoardDay counts from fixture rows, one row per board per day, and a re-run overwrites.
// Uses a board name no real job has, temporary companies, jobs and a user, all removed at the end.
//   npx tsx scripts/board-day-test.ts
import { db } from "../src/lib/db";
import { boardDays, computeBoardDay, utcDay, writeBoardDay } from "../src/modules/jobs";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const stamp = Date.now();
const SOURCE = `bdtest${stamp}`;
const OTHER = `bdtest${stamp}x`;
const DAY = new Date("2026-11-08T10:00:00Z");
const at = (hour: number, dayOffset = 0) => new Date(Date.UTC(2026, 10, 8 + dayOffset, hour));

type JobSeed = { title: string; eligibility: string; fn: string; seniority: string | null; exp: number | null; firstSeenAt: Date; closed?: boolean };
const SEEDS: JobSeed[] = [
  // open India tech entry, first seen that day
  { title: "Software Engineer I", eligibility: "india", fn: "engineering", seniority: "entry", exp: null, firstSeenAt: at(5) },
  // open remote-India data job, no level, 2 years asked: entry by experience; first seen that day
  { title: "Data Analyst", eligibility: "remote_india", fn: "data_ai", seniority: null, exp: 2, firstSeenAt: at(20) },
  // open India non-tech senior, first seen the day before
  { title: "Senior Recruiter", eligibility: "india", fn: "non_tech", seniority: "senior", exp: 6, firstSeenAt: at(10, -1) },
  // open abroad: never counted
  { title: "Backend Engineer", eligibility: "abroad", fn: "engineering", seniority: null, exp: null, firstSeenAt: at(6) },
  // closed India: not open, but new that day
  { title: "QA Engineer", eligibility: "india", fn: "engineering", seniority: null, exp: 4, firstSeenAt: at(7), closed: true },
  // first seen the next day: not new on DAY, but open now
  { title: "Frontend Engineer", eligibility: "india", fn: "engineering", seniority: "mid", exp: 3, firstSeenAt: at(1, 1) },
];

async function main() {
  check("utcDay is midnight UTC of the day", utcDay(new Date("2026-11-08T23:59:00Z")).toISOString() === "2026-11-08T00:00:00.000Z");

  const A = await db.company.create({ data: { source: SOURCE, slug: `a-${stamp}`, name: "BD A", active: true } });
  const B = await db.company.create({ data: { source: SOURCE, slug: `b-${stamp}`, name: "BD B", active: true } });
  await db.company.create({ data: { source: SOURCE, slug: `c-${stamp}`, name: "BD C", active: false } });
  const user = await db.user.create({ data: { email: `bd-${stamp}@swipeapply.local`, name: "bd" } });
  const jobs = [];
  try {
    for (const [i, seed] of SEEDS.entries()) {
      jobs.push(
        await db.job.create({
          data: {
            source: SOURCE, externalId: `bd-${stamp}-${i}`, companyId: i % 2 ? B.id : A.id, title: seed.title, location: "Bengaluru", country: "IN",
            remoteType: "onsite", experienceMin: seed.exp, description: "x", applyUrl: "https://example.invalid", postedAt: at(1), fetchedAt: at(1),
            eligibility: seed.eligibility, function: seed.fn, seniority: seed.seniority, firstSeenAt: seed.firstSeenAt, closedAt: seed.closed ? at(9) : null, raw: {},
          },
        }),
      );
    }
    await db.swipe.create({ data: { userId: user.id, jobId: jobs[0].id, direction: "right", createdAt: at(8) } });
    await db.swipe.create({ data: { userId: user.id, jobId: jobs[1].id, direction: "left", createdAt: at(8) } });
    await db.swipe.create({ data: { userId: user.id, jobId: jobs[2].id, direction: "right", createdAt: at(8, -1) } });
    await db.application.create({ data: { userId: user.id, jobId: jobs[0].id, status: "submitted", fields: [], pendingQuestions: [], submittedAt: at(9) } });
    await db.application.create({ data: { userId: user.id, jobId: jobs[2].id, status: "failed", fields: [], pendingQuestions: [] } });

    const [row, other] = await computeBoardDay(DAY, [SOURCE, OTHER]);
    check("one row per board asked, in order", row.source === SOURCE && other.source === OTHER);
    check("companies: active ones only", row.companies === 2, `${row.companies}`);
    check("before M2 every active company is in the active tier", row.active === 2 && row.open === 0 && row.empty === 0 && row.dead === 0);
    check("open India jobs now: india and remote_india, open only (the next-day job is open now)", row.openIndia === 4, `${row.openIndia}`);
    check("India tech: engineering and data_ai", row.openIndiaTech === 3, `${row.openIndiaTech}`);
    check("India entry: intern or entry level, or 2 years or less", row.openIndiaEntry === 2, `${row.openIndiaEntry}`);
    check("new India jobs: first seen that UTC day, open or closed, India only", row.newIndia === 3, `${row.newIndia}`);
    check("right swipes that day only", row.swipesRight === 1, `${row.swipesRight}`);
    check("submitted that day only", row.submitted === 1, `${row.submitted}`);
    check("a board with nothing gets a row of zeros", other.companies === 0 && other.openIndia === 0 && other.newIndia === 0);

    await writeBoardDay(DAY, [SOURCE]);
    await db.job.update({ where: { id: jobs[1].id }, data: { closedAt: at(22) } });
    await writeBoardDay(at(23), [SOURCE]);
    const written = await boardDays(DAY, DAY, [SOURCE]);
    check("a second write of the same day overwrites: one row", written.length === 1, `${written.length}`);
    check("the overwrite carries the new counts", written[0]?.openIndia === 3, `${written[0]?.openIndia}`);
    check("the row is stored on the UTC day", written[0]?.day.toISOString().slice(0, 10) === "2026-11-08");
  } finally {
    const ids = jobs.map((job) => job.id);
    await db.boardDay.deleteMany({ where: { source: { in: [SOURCE, OTHER] } } });
    await db.application.deleteMany({ where: { jobId: { in: ids } } });
    await db.swipe.deleteMany({ where: { jobId: { in: ids } } });
    await db.job.deleteMany({ where: { source: SOURCE } });
    await db.company.deleteMany({ where: { source: SOURCE } });
    await db.user.deleteMany({ where: { id: user.id } });
  }
  console.log(failed ? `FAIL board-day-test: ${failed} failed` : "PASS board-day-test");
  if (failed) process.exitCode = 1;
}
main().finally(() => db.$disconnect());
