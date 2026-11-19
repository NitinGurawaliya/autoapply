// Learning from skips (Phase P, P8; modules/profile/learning.ts). Offline: the decision (three "not my field" in one
// family within 30 days after its last dismissal; own track → the ask, the last track → "Change your fields?", any other
// family → a learned line; contract and internship asks; one ask a day). Then a throwaway test user with mock jobs:
// the reason saved before and after the swipe, never on a right swipe; the own-track ask and its Yes; a learned line
// lowers rank only (scores unchanged, order = score − 10); deleting it restores the order card for card; the next skip
// does not bring it back, three new ones do. With --server http://localhost:3000, the same user over HTTP: a reason
// before the swipe's POST lands is a 200, and the feed after it is a cache hit (timed), not a rebuild. All removed.
// npx tsx scripts/learning-test.ts [--server http://localhost:3000]
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { forgetFeed } from "../src/lib/feed-cache";
import { deleteAccount } from "../src/modules/account";
import { parseFeedFilters, type FeedJob } from "../src/modules/jobs";
import { rankedFeed } from "../src/modules/jobs/match";
import { answerAsk, currentBrief, deleteLearned, learnFromSkips, recordReason, type LearnedLine } from "../src/modules/profile";
import { decide, LEARNED_RANK } from "../src/modules/profile/learning";

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
  const row = (family: string | null, daysAgo: number, reason: string | null = "not_my_field", direction = "left", kind: string | null = null) => ({ direction, reason, family, createdAt: new Date(now - daysAgo * DAY), kind });
  const run = (rows: ReturnType<typeof row>[], options: { learned?: LearnedLine[]; tracks?: string[]; avoid?: string[] } = {}) =>
    decide({ rows, learned: options.learned ?? [], tracks: options.tracks ?? ["backend", "frontend"], avoid: options.avoid ?? [], now });
  const three = (family: string) => [row(family, 1), row(family, 2), row(family, 3)];

  let r = run(three("backend"));
  check("three on an own track ask to stop showing it", r.ask?.type === "stop_track" && r.ask.title === "Stop showing Backend roles?" && r.lines.length === 0, JSON.stringify(r.ask));
  r = run(three("backend"), { tracks: ["backend"] });
  check("on the last track the ask is to change fields", r.ask?.type === "change_fields" && r.ask.title === "Change your fields?", JSON.stringify(r.ask));
  r = run(three("data_engineering"));
  check("three on another family make a learned line, no ask", r.lines.length === 1 && r.lines[0].family === "data_engineering" && r.lines[0].note === "You skip most Data engineering roles" && r.ask === null);
  r = run(three("software"));
  check("the plain software slot learns too", r.lines.length === 1 && r.lines[0].family === "software");
  r = run(three("data_engineering").slice(0, 2));
  check("two are not enough", r.lines.length === 0 && r.ask === null);
  r = run([row("data_engineering", 1), row("data_engineering", 2), row("data_engineering", 31)]);
  check("a skip over 30 days old does not count", r.lines.length === 0);
  r = run(three("data_engineering"), { learned: [{ id: "x", kind: "rank", family: "data_engineering", note: "n", at: new Date(now - 10 * DAY).toISOString(), dismissedAt: new Date(now - 2.5 * DAY).toISOString() }] });
  check("only skips after the family's last dismissal count", r.lines.length === 0);
  r = run([...three("data_engineering"), row("data_engineering", 0.5), row("data_engineering", 0.6)], { learned: [{ id: "x", kind: "rank", family: "data_engineering", note: "n", at: new Date(now - 10 * DAY).toISOString(), dismissedAt: new Date(now - 2.5 * DAY).toISOString() }] });
  check("three new ones after it make a new line", r.lines.length === 1);
  r = run(three("data_engineering"), { learned: [{ id: "x", kind: "rank", family: "data_engineering", note: "n", at: new Date(now - DAY).toISOString(), dismissedAt: null }] });
  check("an active line is never made twice", r.lines.length === 0);
  r = run([row("data_engineering", 1, "too_senior"), row("data_engineering", 2, "place"), row("data_engineering", 3, "other")]);
  check("other reasons do not count toward a field", r.lines.length === 0 && r.ask === null);
  r = run([row("data_engineering", 1), row("data_engineering", 2), row("data_engineering", 3, "not_my_field", "right")]);
  check("a skip turned into an apply does not count", r.lines.length === 0);
  r = run(three("non_tech"));
  check("a family outside the tracks list is ignored", r.lines.length === 0 && r.ask === null);
  r = run(three("backend"), { learned: [{ id: "a", kind: "ask", family: "kind:intern", note: "n", at: new Date(now - 2 * 60 * 60 * 1000).toISOString(), dismissedAt: null }] });
  check("no ask within a day of the last one", r.ask === null);
  r = run(three("backend"), { learned: [{ id: "a", kind: "ask", family: "kind:intern", note: "n", at: new Date(now - 25 * 60 * 60 * 1000).toISOString(), dismissedAt: null }] });
  check("an ask again after a day", r.ask?.type === "stop_track");
  r = run([...three("backend"), ...three("frontend")]);
  check("one question at a time", r.ask !== null && r.lines.length === 0);
  const contract = [row("backend", 1, "other", "left", "contract"), row("backend", 2, "place", "left", "contract"), row("frontend", 3, "too_senior", "left", "contract")];
  r = run(contract);
  check("three contract roles skipped with a reason ask to hide them", r.ask?.type === "hide_kind" && r.ask.title === "Hide contract roles?" && r.ask.done === "Contract roles are hidden.", JSON.stringify(r.ask));
  r = run([...contract, row("backend", 4, null, "right", "contract")]);
  check("not when one was applied to", r.ask === null);
  r = run(contract, { avoid: ["contract"] });
  check("not when contract roles are already hidden", r.ask === null);
  r = run([row("backend", 1, "other", "left", "intern"), row("backend", 2, "other", "left", "intern"), row("backend", 3, null, "left", "intern")]);
  check("a skip without a reason is not a pattern", r.ask === null);
}

async function main() {
  offline();

  const user = await db.user.create({ data: { email: `learn-${stamp}@swipeapply.local`, name: "Learn" } });
  // No title, skills or experience: no resume vector, so the feed is ranked by tracks and nothing is sent to a model.
  await db.profile.create({ data: { userId: user.id, isTest: true, resumeKey: "x", resumeText: "", fullName: "Learn", email: user.email, yearsExperience: 3, skills: [], tracks: ["eng_management", "qa"], experience: [], education: [], rawJson: {} } });
  const company = await db.company.create({ data: { source: "mock", slug: `learn-${stamp}`, name: `Learn Co ${stamp}`, active: false } });
  const make = (title: string, track: string, i: number) =>
    db.job.create({ data: { source: "mock", externalId: `learn-${track}-${i}-${stamp}`, companyId: company.id, title: `${title} ${i + 1}`, track, location: "Bengaluru, India", country: "IN", remoteType: "unknown", description: "Testing. 2-3 years of experience.", applyUrl: "http://localhost:3000/mock/greenhouse", postedAt: new Date(), fetchedAt: new Date(), raw: {} } });
  const data = await Promise.all(Array.from({ length: 12 }, (_, i) => make("Data Engineer", "data_engineering", i)));
  const qa = await Promise.all(Array.from({ length: 6 }, (_, i) => make("QA Engineer", "qa", i)));
  const managers = await Promise.all(Array.from({ length: 6 }, (_, i) => make("Engineering Manager", "eng_management", i)));
  // Outside the user's fields too, so they score as the Data engineering ones do; made after them, so on equal rank they
  // come after them (rows arrive by id). Only the learned line can put them ahead.
  const security = await Promise.all(Array.from({ length: 6 }, (_, i) => make("Security Engineer", "security", i)));
  const mockIds = new Set([...data, ...qa, ...managers, ...security].map((job) => job.id));
  const filters = parseFeedFilters({});
  const feed = async () => {
    forgetFeed(user.id);
    return (await rankedFeed(user.id, filters)).jobs;
  };
  const skip = async (jobId: string, reason: "not_my_field" | "other" = "not_my_field") => {
    await db.swipe.create({ data: { userId: user.id, jobId, direction: "left", family: (await db.job.findUnique({ where: { id: jobId } }))!.track } });
    return (await recordReason(user.id, jobId, reason)).saved;
  };

  try {
    // The reason before the swipe lands, and after it; never on a right swipe.
    const first = await recordReason(user.id, managers[0].id, "other");
    check("a reason before the swipe makes the left swipe", first.saved === "ok");
    check("…and \"Other\" on a plain job moves no count (no learning pass)", first.counts === false);
    let row = await db.swipe.findUnique({ where: { userId_jobId: { userId: user.id, jobId: managers[0].id } } });
    check("…with its reason and the job's family", row?.direction === "left" && row.reason === "other" && row.family === "eng_management", JSON.stringify(row));
    const late = await db.swipe.create({ data: { userId: user.id, jobId: managers[0].id, direction: "left" } }).then(() => "created", () => "conflict");
    check("…so the deck's POST landing second conflicts (the deck ignores its 409)", late === "conflict");
    check("a reason after the swipe updates it", (await skip(managers[1].id, "other")) === "ok");
    await db.swipe.create({ data: { userId: user.id, jobId: managers[2].id, direction: "right" } });
    check("a right swipe is never changed", (await recordReason(user.id, managers[2].id, "not_my_field")).saved === "not_left");
    row = await db.swipe.findUnique({ where: { userId_jobId: { userId: user.id, jobId: managers[2].id } } });
    check("…its row keeps no reason", row?.direction === "right" && row.reason === null);
    check("an unknown job is not found", (await recordReason(user.id, `missing-${stamp}`, "other")).saved === "not_found");

    // Own track: three "not my field" on QA → "Stop showing QA / Test roles?"; Yes drops it from the fields.
    await skip(qa[0].id);
    check("one skip asks nothing", (await learnFromSkips(user.id)).ask === null);
    await skip(qa[1].id);
    await skip(qa[2].id);
    const own = await learnFromSkips(user.id);
    check("the own-track ask appears after three", own.ask?.type === "stop_track" && own.ask.title === "Stop showing QA / Test roles?" && !own.learned, JSON.stringify(own.ask));
    check("…once: the next reason asks nothing that day", (await learnFromSkips(user.id)).ask === null);
    const brief = await db.candidateBrief.findUnique({ where: { userId: user.id } });
    const fitHash = brief?.fitHash;

    // Another family: three "not my field" on Data engineering → a learned line, rank only.
    const before = await feed();
    const mockBefore = before.filter((job) => mockIds.has(job.id));
    await skip(data[0].id);
    await skip(data[1].id);
    await skip(data[2].id);
    const learned = await learnFromSkips(user.id);
    check("three on another family make a learned line", learned.learned && learned.ask === null);
    const lines = (await currentBrief(user.id))?.learned ?? [];
    check("…shown on /account as \"You skip most Data engineering roles\"", lines.length === 1 && lines[0].note === "You skip most Data engineering roles", JSON.stringify(lines));
    check("…and the brief and its fitHash are unchanged", (await db.candidateBrief.findUnique({ where: { userId: user.id } }))?.fitHash === fitHash);

    const shown = new Set(before.map((job) => job.id));
    for (const id of [data[0].id, data[1].id, data[2].id]) shown.delete(id);
    const after = await feed();
    const same = before.filter((job) => shown.has(job.id));
    const score = new Map(same.map((job) => [job.id, job.score]));
    check("the same jobs are in the feed", after.length === same.length && after.every((job) => score.has(job.id)), `${after.length} vs ${same.length}`);
    check("every score is unchanged", after.every((job) => score.get(job.id) === job.score));
    const noted = after.filter((job) => job.learnedNote);
    check("the learned note is on the Data engineering jobs only", noted.length === 9 && noted.every((job) => job.title.startsWith("Data Engineer")) && after.filter((job) => !job.learnedNote).every((job) => !job.title.startsWith("Data Engineer")), `${noted.length}`);
    const mockAfter = after.filter((job) => mockIds.has(job.id));
    const key = (job: FeedJob) => job.score - (job.learnedNote ? LEARNED_RANK : 0);
    const ordered = mockAfter.every((job, i) => i === 0 || key(mockAfter[i - 1]) > key(job) || (key(mockAfter[i - 1]) === key(job) && mockAfter[i - 1].score >= job.score));
    check(`the mock jobs are ordered by score − ${LEARNED_RANK} for the learned family`, ordered, mockAfter.map((job) => `${job.score}${job.learnedNote ? "L" : ""}`).join(" "));
    const position = (list: FeedJob[], id: string) => list.findIndex((job) => job.id === id);
    const moved = data.slice(3).filter((job) => position(after, job.id) > position(same, job.id)).length;
    const lastData = Math.max(...data.slice(3).map((job) => position(mockBefore, job.id)));
    const firstSecurity = Math.min(...security.map((job) => position(mockBefore, job.id)));
    check("before the line, the equal-scored Data engineering cards came before the Security ones", lastData < firstSecurity && security.every((job) => score.get(job.id) === score.get(data[3].id)), `${lastData} ${firstSecurity}`);
    check("after it, every Security card is ahead of every Data engineering card", Math.max(...security.map((job) => position(after, job.id))) < Math.min(...data.slice(3).map((job) => position(after, job.id))));
    check(`Data engineering cards moved down: ${moved} of 9`, moved === 9);

    // Deleting it restores the order card for card; the next skip does not bring it back; three new ones do.
    check("deleting the line works", await deleteLearned(user.id, lines[0].id));
    check("…and it is not deleted twice", !(await deleteLearned(user.id, lines[0].id)));
    const restored = await feed();
    check("the order is restored card for card", JSON.stringify(restored.map((job) => job.id)) === JSON.stringify(same.map((job) => job.id)) && restored.every((job) => !job.learnedNote), `${restored.length}`);
    await skip(data[3].id);
    const next = await learnFromSkips(user.id);
    check("the next skip does not bring it back", !next.learned && ((await currentBrief(user.id))?.learned.length ?? 0) === 0);
    await skip(data[4].id);
    check("nor the second", !(await learnFromSkips(user.id)).learned);
    await skip(data[5].id);
    check("three new ones do", (await learnFromSkips(user.id)).learned && ((await currentBrief(user.id))?.learned.length ?? 0) === 1);

    // The ask's answers: Yes drops QA from the fields (a field change); asking again is not found.
    const yes = await answerAsk(user.id, "qa", true);
    const profile = await db.profile.findUnique({ where: { userId: user.id }, select: { tracks: true } });
    check("Yes stops showing the field", yes.found && yes.changed && JSON.stringify(profile?.tracks) === JSON.stringify(["eng_management"]), JSON.stringify(profile?.tracks));
    check("an answered ask is closed", !(await answerAsk(user.id, "qa", false)).found);
    check("an ask never made is not found", !(await answerAsk(user.id, "kind:contract", true)).found);

    if (SERVER) await overHttp(user.id, data.slice(6));
    else console.log("     (no --server: the HTTP checks were not run)");
  } finally {
    await deleteAccount(user.id);
    await db.job.deleteMany({ where: { companyId: company.id } });
    await db.company.delete({ where: { id: company.id } });
    const left = await db.swipe.count({ where: { userId: user.id } });
    check("the test user, its swipes, its brief and the mock jobs are removed", left === 0 && (await db.candidateBrief.count({ where: { userId: user.id } })) === 0 && (await db.job.count({ where: { companyId: company.id } })) === 0);
  }
}

/** The same user on the dev server: a reason before the swipe's POST is a 200, and the feed after it is a cache hit. */
async function overHttp(userId: string, jobs: Array<{ id: string }>) {
  const token = randomBytes(16).toString("hex");
  await db.session.create({ data: { sessionToken: token, userId, expires: new Date(Date.now() + 1_800_000) } });
  const headers = { "Content-Type": "application/json", Cookie: `authjs.session-token=${token}` };
  const timed = async (path: string, init: RequestInit = {}) => {
    const started = performance.now();
    const response = await fetch(`${SERVER}${path}`, { ...init, headers });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body, ms: Math.round(performance.now() - started) };
  };
  // Compile the routes once, so the timings below are the requests themselves.
  await timed(`/api/swipes/${jobs[0].id}`, { method: "PATCH", body: "{}" });
  await timed("/api/swipes", { method: "POST", body: "{}" });
  const cold = await timed("/api/jobs");
  const warm = await timed("/api/jobs");
  const listed = (cold.body as { jobs?: FeedJob[] }).jobs ?? [];
  check("the feed loads on the server", cold.status === 200 && listed.length > 0, `${cold.status} ${listed.length}`);
  const target = jobs.find((job) => listed.some((item) => item.id === job.id)) ?? jobs[0];

  const reason = await timed(`/api/swipes/${target.id}`, { method: "PATCH", body: JSON.stringify({ reason: "not_my_field" }) });
  check("a reason before the swipe's POST lands is a 200, not a 409", reason.status === 200, `${reason.status} ${JSON.stringify(reason.body)}`);
  const post = await timed("/api/swipes", { method: "POST", body: JSON.stringify({ jobId: target.id, direction: "left" }) });
  check("the POST landing second gets the 409 the deck ignores", post.status === 409);
  const afterReason = await timed("/api/jobs");
  const gone = !((afterReason.body as { jobs?: FeedJob[] }).jobs ?? []).some((job) => job.id === target.id);
  check(`no feed rebuild after the reason: a cache hit (cold ${cold.ms} ms, cached ${warm.ms} ms, PATCH ${reason.ms} ms, after ${afterReason.ms} ms)`, afterReason.ms <= Math.max(3 * warm.ms, 600) && afterReason.ms < cold.ms, "");
  check("…and the skipped card is gone from it", gone);

  const other = jobs.find((job) => job.id !== target.id)!;
  const second = await timed("/api/swipes", { method: "POST", body: JSON.stringify({ jobId: other.id, direction: "left" }) });
  const then = await timed(`/api/swipes/${other.id}`, { method: "PATCH", body: JSON.stringify({ reason: "place" }) });
  check("a reason after the swipe is a 200 too", second.status === 200 && then.status === 200, `${second.status} ${then.status} ${then.ms} ms`);
  const bad = await timed(`/api/swipes/${other.id}`, { method: "PATCH", body: JSON.stringify({ reason: "bored" }) });
  check("an unknown reason is refused", bad.status === 400);
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
