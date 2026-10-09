// Ingest contract: closing jobs the board dropped, reopening, dedupe of one role across boards, closed jobs out of the feed.
// npx tsx scripts/ingest-contract-test.ts
import { db } from "../src/lib/db";
import { deleteAccount } from "../src/modules/account";
import { companyKey, roleKey } from "../src/modules/governance";
import { listFeed, parseFeedFilters } from "../src/modules/jobs";
import { dedupeListings } from "../src/modules/jobs/match";
import { markClosed } from "../src/modules/jobs/ingest";

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
  await db.profile.create({ data: { userId: user.id, resumeKey: "x", resumeText: "x", fullName: "I", email: user.email, currentTitle: "Software Engineer", yearsExperience: 1, skills: [], experience: [], education: [], rawJson: {} } });
  const company = await db.company.create({ data: { source: "greenhouse", slug: `ing-${stamp}`, name: `Ing Co ${stamp}`, active: false } });
  const mk = (n: string) =>
    db.job.create({ data: { source: "greenhouse", externalId: `ing-${n}-${stamp}`, companyId: company.id, title: `Software Engineer ${n}`, location: "Bengaluru, India", country: "IN", remoteType: "unknown", description: "Software Engineer. 0-2 years of experience.", applyUrl: "https://job-boards.greenhouse.io/x/jobs/1", postedAt: new Date(), fetchedAt: new Date(), raw: {} } });
  try {
    const [a, b] = [await mk("a"), await mk("b")];
    check("an empty listing closes nothing", (await markClosed(company.id, "greenhouse", [])) === 0 && (await db.job.count({ where: { companyId: company.id, closedAt: null } })) === 2);
    check("a job missing from the listing is closed, the listed one is not", (await markClosed(company.id, "greenhouse", [a.externalId])) === 1 && !!(await db.job.findUnique({ where: { id: b.id } }))?.closedAt && !(await db.job.findUnique({ where: { id: a.id } }))?.closedAt);
    check("closing twice changes nothing", (await markClosed(company.id, "greenhouse", [a.externalId])) === 0);
    check("another board's jobs are untouched", (await markClosed(company.id, "lever", ["nope"])) === 0);
    const feed = await listFeed(user.id, parseFeedFilters({}));
    check("the feed shows the open job and hides the closed one", feed.some((f) => f.id === a.id) && !feed.some((f) => f.id === b.id));
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
