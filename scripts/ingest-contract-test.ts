// Ingest contract: closing jobs the board dropped, reopening, dedupe of one role across boards, closed jobs out of the feed;
// T79: unchanged jobs are not rewritten, runs never overlap, old closed jobs nobody used are deleted.
// npx tsx scripts/ingest-contract-test.ts
import { db } from "../src/lib/db";
import { deleteAccount } from "../src/modules/account";
import { companyKey, roleKey } from "../src/modules/governance";
import { listFeed, parseFeedFilters } from "../src/modules/jobs";
import { dedupeListings } from "../src/modules/jobs/match";
import { contentHash, deleteOldClosedJobs, ingestJobs, markClosed } from "../src/modules/jobs/ingest";
import type { FetchedJob } from "../src/modules/jobs/normalize";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const stamp = Date.now();

async function main() {
  check("company names match across punctuation and case", companyKey("Acme, Inc.") === companyKey("ACME Inc") && companyKey("Acme") !== companyKey("Acme Labs"));
  check("the same title is the same role", roleKey("acme", "Software Engineer - I") === roleKey("acme", "software engineer i"));

  const rows = [
    { roleKey: "a|se", location: "Bengaluru", source: "lever", daysAgo: 1 },
    { roleKey: "a|se", location: "Bengaluru, India", source: "greenhouse", daysAgo: 3 },
    { roleKey: "a|se", location: "Bengaluru", source: "greenhouse", daysAgo: 3 },
    { roleKey: "a|se", location: "London", source: "ashby", daysAgo: 1 },
  ];
  const kept = dedupeListings(rows);
  check("one role on two boards is one card, preferring the better board; other places stay", kept.length === 3 && kept.some((r) => r === rows[2]) && !kept.includes(rows[0]) && kept.includes(rows[3]), kept.map((r) => r.source).join(","));

  const user = await db.user.create({ data: { email: `ing-${stamp}@swipeapply.local`, name: "ing" } });
  await db.profile.create({ data: { userId: user.id, resumeKey: "x", resumeText: "x", fullName: "I", email: user.email, currentTitle: "Software Engineer", yearsExperience: 1, skills: ["Quixotlang"], experience: [], education: [], rawJson: {} } });
  const company = await db.company.create({ data: { source: "greenhouse", slug: `ing-${stamp}`, name: `Ing Co ${stamp}`, active: false } });
  const mk = (n: string) =>
    db.job.create({ data: { source: "greenhouse", externalId: `ing-${n}-${stamp}`, companyId: company.id, title: `Software Engineer Quixotlang ${n}`, location: "Bengaluru, India", country: "IN", remoteType: "unknown", description: "Software Engineer, Quixotlang. 0-2 years of experience.", applyUrl: "https://job-boards.greenhouse.io/x/jobs/1", postedAt: new Date(), fetchedAt: new Date(), raw: {} } });
  try {
    const [a, b] = [await mk("a"), await mk("b")];
    check("an empty listing closes nothing", (await markClosed(company.id, "greenhouse", [])) === 0 && (await db.job.count({ where: { companyId: company.id, closedAt: null } })) === 2);
    check("a job missing from the listing is closed, the listed one is not", (await markClosed(company.id, "greenhouse", [a.externalId])) === 1 && !!(await db.job.findUnique({ where: { id: b.id } }))?.closedAt && !(await db.job.findUnique({ where: { id: a.id } }))?.closedAt);
    check("closing twice changes nothing", (await markClosed(company.id, "greenhouse", [a.externalId])) === 0);
    check("another board's jobs are untouched", (await markClosed(company.id, "lever", ["nope"])) === 0);
    const feed = await listFeed(user.id, parseFeedFilters({}));
    check("the feed shows the open job and hides the closed one", feed.some((f) => f.id === a.id) && !feed.some((f) => f.id === b.id));

    // T79: the content hash changes only with what ingest stores.
    const posting: FetchedJob = { externalId: "1", title: "Engineer", location: "Bengaluru", description: "x", applyUrl: "https://a", postedAt: new Date("2026-10-01T00:00:00Z"), offices: ["India"], raw: { any: 1 } };
    check("the same posting hashes the same", contentHash(posting) === contentHash({ ...posting, raw: { other: 2 } }));
    check("a changed title, place or office changes the hash", contentHash(posting) !== contentHash({ ...posting, title: "Senior Engineer" }) && contentHash(posting) !== contentHash({ ...posting, offices: ["US"] }));

    // T79: a run that has not finished stops another one.
    const blocker = await db.ingestRun.create({ data: {} });
    check("a second run while one is going skips itself", (await ingestJobs(1)) === null);
    await db.ingestRun.delete({ where: { id: blocker.id } });

    // T79: closed jobs nobody used are deleted 30 days after closing; one someone swiped stays.
    const old = new Date(Date.now() - 40 * 864e5);
    const [gone, kept] = [await mk("gone"), await mk("kept")];
    await db.job.updateMany({ where: { id: { in: [gone.id, kept.id] } }, data: { closedAt: old } });
    await db.swipe.create({ data: { userId: user.id, jobId: kept.id, direction: "left" } });
    await deleteOldClosedJobs();
    check("an old closed job nobody used is deleted", !(await db.job.findUnique({ where: { id: gone.id } })));
    check("an old closed job someone swiped is kept", !!(await db.job.findUnique({ where: { id: kept.id } })));
  } finally {
    await db.job.deleteMany({ where: { companyId: company.id } });
    await db.company.delete({ where: { id: company.id } });
    await deleteAccount(user.id).catch(() => undefined);
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS ingest-contract" : `FAIL ingest-contract (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
