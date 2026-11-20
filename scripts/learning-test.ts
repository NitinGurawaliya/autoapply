// Learning from swipes (Phase P, P8; modules/profile/learning.ts), with no question to the user (20 Nov). Offline: the
// decision (five skips in a field outside the user's fields, eight in one of their own, three in a kind, none applied
// to, within 30 days after the last dismissal; an apply after a line lifts it). Then a throwaway test user with mock
// jobs: a learned line lowers rank only (scores unchanged, order = score − 10) and shows on /account; deleting it
// restores the order card for card and the next skips do not bring it back; an own-track field and a kind learn too;
// an apply lifts a line by itself. With --server http://localhost:3000, the same user over HTTP: a skip's POST answers
// at once (the learning runs after it), five skips make a line, and the "Why?" and question routes are gone.
// npx tsx scripts/learning-test.ts [--server http://localhost:3000]
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { forgetFeed } from "../src/lib/feed-cache";
import { deleteAccount } from "../src/modules/account";
import { parseFeedFilters, type FeedJob } from "../src/modules/jobs";
import { rankedFeed } from "../src/modules/jobs/match";
import { currentBrief, deleteLearned, learnFromSwipes, type LearnedLine } from "../src/modules/profile";
import { decide, LEARN_AFTER_KIND, LEARN_AFTER_OTHER, LEARN_AFTER_OWN, LEARNED_RANK } from "../src/modules/profile/learning";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const at = process.argv.indexOf("--server");
const SERVER = at >= 0 ? process.argv[at + 1] : null;
const stamp = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function offline() {
  const now = Date.parse("2026-11-19T12:00:00Z");
  const row = (family: string | null, daysAgo: number, direction = "left", kind: string | null = null) => ({ direction, family, createdAt: new Date(now - daysAgo * DAY), kind });
  const run = (rows: ReturnType<typeof row>[], options: { learned?: LearnedLine[]; tracks?: string[]; avoid?: string[] } = {}) =>
    decide({ rows, learned: options.learned ?? [], tracks: options.tracks ?? ["backend", "frontend"], avoid: options.avoid ?? [], now });
  const many = (family: string, n: number, kind: string | null = null) => Array.from({ length: n }, (_, i) => row(family, 1 + i * 0.1, "left", kind));
  const line = (family: string, atDaysAgo: number, dismissedDaysAgo: number | null = null): LearnedLine => ({ id: `l-${family}`, kind: "rank", family, note: "n", at: new Date(now - atDaysAgo * DAY).toISOString(), dismissedAt: dismissedDaysAgo === null ? null : new Date(now - dismissedDaysAgo * DAY).toISOString() });

  let r = run(many("data_engineering", LEARN_AFTER_OTHER));
  check(`${LEARN_AFTER_OTHER} skips in another field make a learned line, nothing asked`, r.lines.length === 1 && r.lines[0].family === "data_engineering" && r.lines[0].note === "You skip most Data engineering roles" && r.lift.length === 0);
  r = run(many("data_engineering", LEARN_AFTER_OTHER - 1));
  check("one fewer is not enough", r.lines.length === 0);
  r = run(many("software", LEARN_AFTER_OTHER));
  check("the plain software slot learns too", r.lines.length === 1 && r.lines[0].family === "software");
  r = run(many("backend", LEARN_AFTER_OWN - 1));
  check(`a field the user chose needs more: ${LEARN_AFTER_OWN - 1} skips are not enough`, r.lines.length === 0);
  r = run(many("backend", LEARN_AFTER_OWN));
  check(`…${LEARN_AFTER_OWN} make a line (never a question, never a change of their fields)`, r.lines.length === 1 && r.lines[0].note === "You skip most Backend roles");
  r = run([...many("data_engineering", LEARN_AFTER_OTHER - 1), row("data_engineering", 31)]);
  check("a skip over 30 days old does not count", r.lines.length === 0);
  r = run([...many("data_engineering", LEARN_AFTER_OTHER + 3), row("data_engineering", 2, "right")]);
  check("a field the user applied to once is never down-ranked", r.lines.length === 0);
  r = run(many("data_engineering", LEARN_AFTER_OTHER), { learned: [line("data_engineering", 10, 0.5)] });
  check("only skips after the family's last dismissal count", r.lines.length === 0);
  r = run([...many("data_engineering", LEARN_AFTER_OTHER), ...Array.from({ length: LEARN_AFTER_OTHER }, (_, i) => row("data_engineering", 0.1 + i * 0.05))], { learned: [line("data_engineering", 10, 2.5)] });
  check("enough new ones after it make a new line", r.lines.length === 1);
  r = run(many("data_engineering", LEARN_AFTER_OTHER + 2), { learned: [line("data_engineering", 1)] });
  check("an active line is never made twice", r.lines.length === 0 && r.lift.length === 0);
  r = run([row("data_engineering", 0.5, "right")], { learned: [line("data_engineering", 3)] });
  check("an apply after a line lifts it", r.lift.length === 1 && r.lift[0] === "l-data_engineering" && r.lines.length === 0);
  r = run([row("data_engineering", 6, "right")], { learned: [line("data_engineering", 3)] });
  check("an apply from before the line does not", r.lift.length === 0);
  r = run(many("non_tech", LEARN_AFTER_OTHER + 2));
  check("a family outside the tracks list is ignored", r.lines.length === 0);

  const contract = many("backend", LEARN_AFTER_KIND, "contract");
  r = run(contract);
  check(`${LEARN_AFTER_KIND} contract roles skipped make a line for that kind`, r.lines.length === 1 && r.lines[0].family === "kind:contract" && r.lines[0].note === "You skip most contract roles", JSON.stringify(r.lines.map((l) => l.note)));
  r = run(many("backend", LEARN_AFTER_KIND, "intern"));
  check("…and internships", r.lines.length === 1 && r.lines[0].note === "You skip most internships");
  r = run([...contract, row("backend", 4, "right", "contract")]);
  check("not when one was applied to", r.lines.length === 0);
  r = run(contract, { avoid: ["contract"] });
  check("not when contract roles are already hidden by the user's chip", r.lines.length === 0);
  r = run([row("backend", 0.5, "right", "contract")], { learned: [line("kind:contract", 3)] });
  check("an apply to that kind lifts its line", r.lift.length === 1 && r.lift[0] === "l-kind:contract");
}

async function main() {
  offline();
  if (SERVER) await overHttp();
  else console.log("     (no --server: the HTTP checks were not run)");

  const user = await db.user.create({ data: { email: `learn-${stamp}@swipeapply.local`, name: "Learn" } });
  // No title, skills or experience: no resume vector, so the feed is ranked by tracks and nothing is sent to a model.
  await db.profile.create({ data: { userId: user.id, isTest: true, resumeKey: "x", resumeText: "", fullName: "Learn", email: user.email, yearsExperience: 3, skills: [], tracks: ["eng_management", "qa"], experience: [], education: [], rawJson: {} } });
  const company = await db.company.create({ data: { source: "mock", slug: `learn-${stamp}`, name: `Learn Co ${stamp}`, active: false } });
  const make = (title: string, track: string, i: number) =>
    db.job.create({ data: { source: "mock", externalId: `learn-${track}-${title}-${i}-${stamp}`, companyId: company.id, title: `${title} ${i + 1}`, track, location: "Bengaluru, India", country: "IN", remoteType: "unknown", description: "Testing. 2-3 years of experience.", applyUrl: "http://localhost:3000/mock/greenhouse", postedAt: new Date(), fetchedAt: new Date(), raw: {} } });
  const data = await Promise.all(Array.from({ length: 14 }, (_, i) => make("Data Engineer", "data_engineering", i)));
  const qa = await Promise.all(Array.from({ length: 10 }, (_, i) => make("QA Engineer", "qa", i)));
  const managers = await Promise.all(Array.from({ length: 6 }, (_, i) => make("Engineering Manager", "eng_management", i)));
  // Outside the user's fields too, so they score as the Data engineering ones do; made after them, so on equal rank they
  // come after them (rows arrive by id). Only the learned line can put them ahead.
  const security = await Promise.all(Array.from({ length: 12 }, (_, i) => make("Security Engineer", "security", i)));
  const mockIds = new Set([...data, ...qa, ...managers, ...security].map((job) => job.id));
  const filters = parseFeedFilters({});
  const feed = async () => {
    forgetFeed(user.id);
    return (await rankedFeed(user.id, filters)).jobs;
  };
  const swipe = async (jobId: string, direction: "left" | "right") => {
    const job = (await db.job.findUnique({ where: { id: jobId } }))!;
    // As POST /api/swipes writes a left swipe (the job's family at that moment); a right one gets none and is read from the job.
    await db.swipe.create({ data: { userId: user.id, jobId, direction, ...(direction === "left" ? { family: job.track } : {}) } });
    return learnFromSwipes(user.id);
  };
  const lines = async () => ((await currentBrief(user.id))?.learned ?? []).filter((item) => !item.dismissedAt);

  try {
    // Another field: five skips on Data engineering → a learned line, rank only.
    for (const job of data.slice(0, LEARN_AFTER_OTHER - 1)) check(`a skip before the ${LEARN_AFTER_OTHER}th changes nothing`, !(await swipe(job.id, "left")).changed);
    const brief = await db.candidateBrief.findUnique({ where: { userId: user.id } });
    const fitHash = brief?.fitHash;
    const before = await feed();
    const mockBefore = before.filter((job) => mockIds.has(job.id));
    const fifth = await swipe(data[LEARN_AFTER_OTHER - 1].id, "left");
    check(`the ${LEARN_AFTER_OTHER}th skip makes a learned line, with no question`, fifth.changed && !("ask" in fifth));
    const made = await lines();
    check("…shown on /account as \"You skip most Data engineering roles\"", made.length === 1 && made[0].note === "You skip most Data engineering roles", JSON.stringify(made));
    check("…and the brief and its fitHash are unchanged", (await db.candidateBrief.findUnique({ where: { userId: user.id } }))?.fitHash === fitHash);

    const shown = new Set(before.map((job) => job.id));
    for (const job of data.slice(0, LEARN_AFTER_OTHER)) shown.delete(job.id);
    const after = await feed();
    const same = before.filter((job) => shown.has(job.id));
    const score = new Map(same.map((job) => [job.id, job.score]));
    check("the same jobs are in the feed", after.length === same.length && after.every((job) => score.has(job.id)), `${after.length} vs ${same.length}`);
    check("every score is unchanged", after.every((job) => score.get(job.id) === job.score));
    const rest = data.length - LEARN_AFTER_OTHER;
    const noted = after.filter((job) => job.learnedNote);
    check("the learned note is on the Data engineering jobs only", noted.length === rest && noted.every((job) => job.title.startsWith("Data Engineer")) && after.filter((job) => !job.learnedNote).every((job) => !job.title.startsWith("Data Engineer")), `${noted.length}`);
    const mockAfter = after.filter((job) => mockIds.has(job.id));
    const key = (job: FeedJob) => job.score - (job.learnedNote ? LEARNED_RANK : 0);
    const ordered = mockAfter.every((job, i) => i === 0 || key(mockAfter[i - 1]) > key(job) || (key(mockAfter[i - 1]) === key(job) && mockAfter[i - 1].score >= job.score));
    check(`the mock jobs are ordered by score − ${LEARNED_RANK} for the learned family`, ordered, mockAfter.map((job) => `${job.score}${job.learnedNote ? "L" : ""}`).join(" "));
    const position = (list: FeedJob[], id: string) => list.findIndex((job) => job.id === id);
    const left = data.slice(LEARN_AFTER_OTHER);
    const moved = left.filter((job) => position(after, job.id) > position(same, job.id)).length;
    const lastData = Math.max(...left.map((job) => position(mockBefore, job.id)));
    const firstSecurity = Math.min(...security.map((job) => position(mockBefore, job.id)));
    check("before the line, the equal-scored Data engineering cards came before the Security ones", lastData < firstSecurity && security.every((job) => score.get(job.id) === score.get(left[0].id)), `${lastData} ${firstSecurity}`);
    check("after it, every Security card is ahead of every Data engineering card", Math.max(...security.map((job) => position(after, job.id))) < Math.min(...left.map((job) => position(after, job.id))));
    check(`Data engineering cards moved down: ${moved} of ${rest}`, moved === rest);

    // Deleting it restores the order card for card; the next skips do not bring it back; enough new ones do.
    check("deleting the line works", await deleteLearned(user.id, made[0].id));
    check("…and it is not deleted twice", !(await deleteLearned(user.id, made[0].id)));
    const restored = await feed();
    check("the order is restored card for card", JSON.stringify(restored.map((job) => job.id)) === JSON.stringify(same.map((job) => job.id)) && restored.every((job) => !job.learnedNote), `${restored.length}`);
    for (let i = 0; i < LEARN_AFTER_OTHER - 1; i++) check(`skip ${i + 1} after the deletion does not bring it back`, !(await swipe(data[LEARN_AFTER_OTHER + i].id, "left")).changed && (await lines()).length === 0);
    check(`the ${LEARN_AFTER_OTHER}th after it does`, (await swipe(data[2 * LEARN_AFTER_OTHER - 1].id, "left")).changed && (await lines()).length === 1);

    // An apply lifts it by itself: the user's later behaviour wins, nothing is asked.
    const lifted = await swipe(data[2 * LEARN_AFTER_OTHER].id, "right");
    check("an apply to that field lifts the line by itself", lifted.changed && (await lines()).length === 0);
    check("…and the feed has no learned note left", (await feed()).every((job) => !job.learnedNote));

    // A field the user chose: eight skips on QA make a line too (never a question, never a change of their fields).
    for (const job of qa.slice(0, LEARN_AFTER_OWN - 1)) await swipe(job.id, "left");
    check(`${LEARN_AFTER_OWN - 1} skips in their own field make nothing`, (await lines()).length === 0);
    check(`the ${LEARN_AFTER_OWN}th makes "You skip most QA / Test roles"`, (await swipe(qa[LEARN_AFTER_OWN - 1].id, "left")).changed && (await lines()).some((item) => item.note === "You skip most QA / Test roles"));
    check("…their fields are untouched", JSON.stringify((await db.profile.findUnique({ where: { userId: user.id }, select: { tracks: true } }))?.tracks) === JSON.stringify(["eng_management", "qa"]));

    // A kind: three contract roles skipped, none applied to → a line for the kind; an apply lifts it. The contract roles
    // are read as contract (a current reading with a kind), made now so the field lines above never covered them.
    const contracts = await Promise.all(Array.from({ length: 5 }, (_, i) => make("Platform Contract Engineer", "data_engineering", i)));
    await db.$executeRaw`UPDATE "Job" SET kind = 'contract', "readingCurrent" = true WHERE id = ANY(${contracts.map((job) => job.id)}::text[])`;
    for (const job of contracts.slice(0, LEARN_AFTER_KIND - 1)) await swipe(job.id, "left");
    check(`${LEARN_AFTER_KIND - 1} contract roles skipped make no kind line`, !(await lines()).some((item) => item.family === "kind:contract"));
    check(`the ${LEARN_AFTER_KIND}th makes "You skip most contract roles"`, (await swipe(contracts[LEARN_AFTER_KIND - 1].id, "left")).changed && (await lines()).some((item) => item.note === "You skip most contract roles"));
    const withKind = await feed();
    const contractNoted = withKind.filter((job) => job.learnedNote === "You skip most contract roles");
    check("the kind's note is on the contract jobs left, and only on them", contractNoted.length === contracts.length - LEARN_AFTER_KIND && contractNoted.every((job) => job.title.startsWith("Platform Contract")), `${contractNoted.length}`);
    check("an apply to a contract role lifts the kind line", (await swipe(contracts[LEARN_AFTER_KIND].id, "right")).changed && !(await lines()).some((item) => item.family === "kind:contract"));

  } finally {
    await deleteAccount(user.id);
    await db.job.deleteMany({ where: { companyId: company.id } });
    await db.company.delete({ where: { id: company.id } });
    const left = await db.swipe.count({ where: { userId: user.id } });
    check("the test user, its swipes, its brief and the mock jobs are removed", left === 0 && (await db.candidateBrief.count({ where: { userId: user.id } })) === 0 && (await db.job.count({ where: { companyId: company.id } })) === 0);
  }
}

/** A fresh user on the dev server: a skip is saved, the learning runs after the response, five skips make a line, the old routes are gone. */
async function overHttp() {
  const user = await db.user.create({ data: { email: `learn-http-${stamp}@swipeapply.local`, name: "Learn Http" } });
  await db.profile.create({ data: { userId: user.id, isTest: true, resumeKey: "x", resumeText: "", fullName: "Learn Http", email: user.email, yearsExperience: 3, skills: [], tracks: ["eng_management"], experience: [], education: [], rawJson: {} } });
  const company = await db.company.create({ data: { source: "mock", slug: `learn-http-${stamp}`, name: `Learn Http Co ${stamp}`, active: false } });
  const make = (title: string, track: string, i: number) =>
    db.job.create({ data: { source: "mock", externalId: `learn-http-${track}-${i}-${stamp}`, companyId: company.id, title: `${title} ${i + 1}`, track, location: "Bengaluru, India", country: "IN", remoteType: "unknown", description: "Testing. 2-3 years of experience.", applyUrl: "http://localhost:3000/mock/greenhouse", postedAt: new Date(), fetchedAt: new Date(), raw: {} } });
  const managers = await Promise.all(Array.from({ length: 3 }, (_, i) => make("Engineering Manager", "eng_management", i)));
  const security = await Promise.all(Array.from({ length: LEARN_AFTER_OTHER + 4 }, (_, i) => make("Security Engineer", "security", i)));
  const token = randomBytes(16).toString("hex");
  await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 1_800_000) } });
  const headers = { "Content-Type": "application/json", Cookie: `authjs.session-token=${token}` };
  const timed = async (path: string, init: RequestInit = {}) => {
    const started = performance.now();
    const response = await fetch(`${SERVER}${path}`, { ...init, headers });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body, ms: Math.round(performance.now() - started) };
  };
  // The stored row itself (currentBrief rebuilds the brief first, far slower than the learning it would race).
  const activeLines = async () => {
    const row = await db.candidateBrief.findUnique({ where: { userId: user.id }, select: { learned: true } });
    return (Array.isArray(row?.learned) ? (row.learned as LearnedLine[]) : []).filter((item) => !item.dismissedAt && item.family === "security").length;
  };
  try {
    await timed("/api/swipes", { method: "POST", body: "{}" });
    // rest=1: the ranked list (with DAILY_SET=1 the default view serves today's set, four cards at first).
    const cold = await timed("/api/jobs?rest=1");
    const listed = (cold.body as { jobs?: FeedJob[] }).jobs ?? [];
    check("the feed loads on the server", cold.status === 200 && listed.length >= managers.length + security.length, `${cold.status} ${listed.length}: ${listed.map((job) => job.title).join(", ")}`);

    let lineAtResponse = -1;
    for (const [i, job] of security.slice(0, LEARN_AFTER_OTHER).entries()) {
      const post = await timed("/api/swipes", { method: "POST", body: JSON.stringify({ jobId: job.id, direction: "left" }) });
      if (post.status !== 200) check(`skip ${i + 1} saved`, false, String(post.status));
      if (i === LEARN_AFTER_OTHER - 1) lineAtResponse = await activeLines();
    }
    check(`the ${LEARN_AFTER_OTHER}th skip answered before its learning finished (the line was not there yet when it answered)`, lineAtResponse === 0, String(lineAtResponse));
    let made = 0;
    for (let waited = 0; waited < 15_000 && made === 0; waited += 500) {
      made = await activeLines();
      if (made === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    check(`${LEARN_AFTER_OTHER} skips over HTTP make the line for Security`, made === 1);
    let noted: FeedJob[] = [];
    for (let waited = 0; waited < 10_000 && noted.length === 0; waited += 500) {
      noted = (((await timed("/api/jobs?rest=1")).body as { jobs?: FeedJob[] }).jobs ?? []).filter((job) => job.learnedNote);
      if (noted.length === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    check("…and the feed served next carries its note on the Security jobs left", noted.length === security.length - LEARN_AFTER_OTHER && noted.every((job) => job.title.startsWith("Security")), `${noted.length}`);

    const reason = await timed(`/api/swipes/${security[0].id}`, { method: "PATCH", body: JSON.stringify({ reason: "not_my_field" }) });
    check("the \"Why?\" route is gone", reason.status === 404 || reason.status === 405, String(reason.status));
    const ask = await timed("/api/brief/ask", { method: "POST", body: JSON.stringify({ family: "qa", yes: true }) });
    check("the question route is gone", ask.status === 404 || ask.status === 405, String(ask.status));
  } finally {
    await deleteAccount(user.id);
    await db.job.deleteMany({ where: { companyId: company.id } });
    await db.company.delete({ where: { id: company.id } });
    check("the HTTP test user and its jobs are removed", (await db.swipe.count({ where: { userId: user.id } })) === 0 && (await db.job.count({ where: { companyId: company.id } })) === 0);
  }
}

main()
  .then(() => {
    console.log(failed === 0 ? "PASS learning-test" : `FAIL learning-test (${failed} failed)`);
    process.exitCode = failed === 0 ? 0 : 1;
  })
  .catch((error) => {
    console.error(error);
    console.log("FAIL learning-test (error)");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
