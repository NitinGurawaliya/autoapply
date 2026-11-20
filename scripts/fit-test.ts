// Phase P, P6: the fit verdict (modules/jobs/fit.ts). Pure part: the per-job JSON (fixed key order, numbered
// requirement lines, no batch index), its jobHash (moves with the reading and the skills split, not otherwise); no fit
// input without a current reading; the message holds the brief exactly and never resume text or contact data; the
// answer check (evidence only as one of the job's own line numbers, `why` at most 12 words, unknown or repeated indexes
// dropped); the level on top (levelOn, and levelFit unchanged through it). DB part, on a throwaway test user and 10 real
// read pool jobs: the lease is compare-and-set; a build judges and writes FitJudgement, a second reads only; a held lease
// judges nothing; a changed brief invalidates the cache; JobJudgement is never written; the user's rows go with it.
// npx tsx scripts/fit-test.ts
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { deleteAccount } from "../src/modules/account";
import { candidateSkills } from "../src/modules/jobs";
import { applyLevel, applyStack, capWords, checkFitAnswer, FIT_SYSTEM, fitInput, fitJobs, fitMessage, fitStats, lineSent, releaseLease, takeLease } from "../src/modules/jobs/fit";
import { poolSql } from "../src/modules/jobs/pool";
import { levelFit, levelOn } from "../src/modules/jobs/semantic";
import { briefJson, briefOf } from "../src/modules/profile/brief";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const EMAIL = "fit.test.person@example.com";
const PHONE = "+91 91234 56780";
const RESUME_PHRASE = "Led the quarterly migration of billing ledgers";
const profileBase = {
  tracks: ["backend"],
  showNearby: false,
  yearsExperience: 3,
  currentTitle: "Backend Engineer",
  skills: ["Node.js", "TypeScript", "PostgreSQL", "AWS", "Docker", EMAIL, PHONE],
  experience: [{ title: "Backend Engineer", summary: "Built billing APIs in Node.js and PostgreSQL" }],
  resumeText: `Fit Test\n${EMAIL}\n${PHONE}\n${RESUME_PHRASE}. Node.js, TypeScript, PostgreSQL, Redis, AWS, Docker, Kafka.`,
};

const job = {
  id: "j1",
  title: "Backend Engineer",
  experienceMin: 2,
  roleFamily: "backend",
  kind: "employee",
  readingCurrent: true,
  reading: { version: 4, summary: "Builds APIs.", evidence: [], requirements: ["2+ years of experience", "Strong Node.js and PostgreSQL", "Experience with AWS"] },
  skills: ["Node.js", "PostgreSQL", "Go", "Kubernetes"],
  skillsRequired: ["Node.js", "Go"],
  skillsHash: "h1",
  contentHash: "h1",
};

function pure() {
  const shows = candidateSkills(profileBase);
  const input = fitInput(job, shows)!;
  check("a current reading gives a fit input", input != null);
  check("no fit input without a current reading", fitInput({ ...job, readingCurrent: false }, shows) === null && fitInput({ ...job, reading: null }, shows) === null);
  check("keys in a fixed order", JSON.stringify(Object.keys(JSON.parse(input.json))) === JSON.stringify(["title", "family", "kind", "summary", "requirements", "skills"]));
  check("requirement lines numbered from 1, a years-only line not sent", input.sent.requirements[0] === "1. Strong Node.js and PostgreSQL" && input.sent.requirements.length === 2 && input.requirements.length === 3);
  check("sent lines map back to the posting's lines", JSON.stringify(input.sentIndex) === "[1,2]");
  check("a years phrase is taken out of a line, the rest kept", lineSent("A minimum of five years of professional experience developing software in Python.") === "developing software in Python." && lineSent("3+ years of experience") === null && lineSent("Strong Node.js") === null && lineSent("Bachelor's degree in Computer Science") === "Bachelor's degree in Computer Science");
  check("no batch index in the job's JSON", !("n" in JSON.parse(input.json)));
  check("skills split by code (labels current)", JSON.stringify(input.sent.skills) === JSON.stringify({ have: ["Node.js", "PostgreSQL"], missing: ["Go"] }), JSON.stringify(input.sent.skills));
  check("same job, same jobHash", fitInput({ ...job }, shows)!.jobHash === input.jobHash);
  check("a stale skills label moves jobHash", fitInput({ ...job, skillsHash: "old" }, shows)!.jobHash !== input.jobHash);
  check("a new reading moves jobHash", fitInput({ ...job, reading: { ...job.reading, requirements: [...job.reading.requirements, "Experience with Kafka streams"] } }, shows)!.jobHash !== input.jobHash);
  check("a column the model never sees does not move jobHash", fitInput({ ...job, experienceMin: 5 }, shows)!.jobHash === input.jobHash);

  const brief = briefOf(profileBase);
  const message = fitMessage(brief, [input, input]);
  check("the message sends the brief exactly", message.startsWith(`{"candidate":${briefJson(brief)},"jobs":[{"n":0,"title"`) && message.includes(`{"n":1,"title"`));
  check("the message parses as JSON", (() => { try { return JSON.parse(message).jobs.length === 2; } catch { return false; } })());
  check("no contact data or raw resume text in the message", ![EMAIL, "example.com", "91234", "56780", RESUME_PHRASE, "Fit Test"].some((s) => message.includes(s)));
  check("the roles are in the message (what they did)", message.includes("Built billing APIs in Node.js and PostgreSQL"));

  const answer = checkFitAnswer(
    {
      results: [
        { n: 0, fit: "good", evidence: 2, why: "Your Node.js and PostgreSQL work matches the core of this backend role here today" },
        { n: 0, fit: "no", evidence: 1, why: "repeat" },
        { n: 1, fit: "stretch", evidence: 9, why: "Out of range." },
        { n: 2, fit: "no", evidence: null, why: "No lines" },
        { n: 7, fit: "strong", evidence: 1, why: "unknown index" },
      ],
    },
    [input, input, { json: "{}", sentIndex: [] }],
  );
  check("evidence kept as the posting's own 0-based line", answer.get(0)?.evidenceIndex === 2 && answer.get(0)?.missed === false);
  check("a repeated index is dropped", answer.get(0)?.fit === "good");
  check("evidence out of range is dropped and counted missed", answer.get(1)?.evidenceIndex === null && answer.get(1)?.missed === true);
  check("no lines, no evidence: not counted missed", answer.get(2)?.evidenceIndex === null && answer.get(2)?.missed === false);
  check("an unknown index is dropped", answer.size === 3);
  check("why is at most 12 words", (answer.get(0)?.why.split(/\s+/).length ?? 99) <= 12 && capWords("a b c d e f g h i j k l m n.").split(" ").length === 12);

  // 20 Nov: the seniority the model reads from the words (no number of years), on top of its fit.
  const leveled = checkFitAnswer(
    {
      results: [
        { n: 0, fit: "strong", evidence: 1, why: "Backend services, your own work", level: "far_above" },
        { n: 1, fit: "good", evidence: 1, why: "Node.js backend, close to your work", level: "above" },
        { n: 2, fit: "strong", evidence: 1, why: "Your own work", level: "fits" },
        { n: 3, fit: "good", evidence: 1, why: "No level given" },
        { n: 4, fit: "stretch", evidence: 1, why: "A neighbouring stack", level: "above" },
        { n: 5, fit: "good", evidence: 1, why: "Not one of the three", level: "gigantic" as never },
      ],
    },
    [input, input, input, input, input, input],
  );
  check("a job far above the candidate is a no, whatever its field", leveled.get(0)?.fit === "no" && leveled.get(0)?.why === "Asks for far more experience than you have");
  check("a job clearly above is at most a stretch, keeping the model's reason", leveled.get(1)?.fit === "stretch" && leveled.get(1)?.why === "Node.js backend, close to your work");
  check("a job that fits keeps its verdict", leveled.get(2)?.fit === "strong");
  check("no level at all keeps the verdict (an answer from before the field)", leveled.get(3)?.fit === "good");
  check("a stretch stays a stretch when above", leveled.get(4)?.fit === "stretch");
  check("an unknown level word is read as none, not a failed batch", leveled.get(5)?.fit === "good");
  check("the level rule on its own: no stays no, far_above never lifts", applyLevel("no", "far_above", "x").fit === "no" && applyLevel("stretch", "far_above", "x").fit === "no" && applyLevel("good", undefined, "x").fit === "good");
  // 20 Nov blind review: a role built on a stack the candidate lacks is at most a stretch, in code (stackGap, applyStack).
  check("a stack gap caps strong and good at stretch, with its reason", applyStack("strong", "x", ["WordPress", "PHP"]).fit === "stretch" && applyStack("good", "x", ["Python"]).why === "Built on Python, not on your resume");
  check("no gap, or a stretch or no, is left as it is", applyStack("strong", "x", []).fit === "strong" && applyStack("no", "x", ["Java"]).fit === "no" && applyStack("stretch", "y", ["Java"]).why === "y");
  check("the fit judge's prompt names all three levels", ["fits", "above", "far_above"].every((word) => FIT_SYSTEM.includes(word)));
  check("levelOn: a senior role for 1 year is no", JSON.stringify(levelOn("strong", "Senior Backend Engineer", null, 1)) === JSON.stringify({ fit: "no", note: "a senior role" }));
  check("levelOn: 2 more years caps at stretch", levelOn("strong", "Backend Engineer", 3, 1).fit === "stretch");
  check("levelOn: no stays no", levelOn("no", "Backend Engineer", null, 3).fit === "no");
  check("levelFit unchanged through levelOn", levelFit("same", { title: "Backend Engineer", description: "You have 4+ years of experience" }, 1).fit === "no" && levelFit("close", { title: "Backend Engineer", description: "" }, 2).fit === "good");
}

async function withDb() {
  const jobs = await db.$queryRaw<Array<{ id: string }>>`
    SELECT j.id FROM "Job" j
    WHERE ${poolSql("j")} AND j."readingCurrent" AND j."roleFamily" = 'backend' AND jsonb_array_length(j.reading -> 'requirements') >= 2
    ORDER BY j."postedAt" DESC LIMIT 12`;
  const ids = jobs.map((row) => row.id);
  check("12 real read backend pool jobs", ids.length === 12, String(ids.length));
  const stamp = randomBytes(4).toString("hex");
  const user = await db.user.create({ data: { email: `fit-${stamp}@swipeapply.local`, name: "Fit Test" } });
  try {
    const profile = await db.profile.create({
      data: { userId: user.id, isTest: true, resumeKey: "", resumeText: profileBase.resumeText, fullName: "Fit Test", email: EMAIL, phone: PHONE, currentTitle: profileBase.currentTitle, yearsExperience: profileBase.yearsExperience, skills: profileBase.skills, experience: profileBase.experience, education: [], rawJson: {}, tracks: profileBase.tracks },
    });
    const brief = briefOf(profile);
    const who = { userId: user.id, profileId: profile.id, brief, shows: candidateSkills(profile), years: profile.yearsExperience };

    check("lease taken when free", await takeLease(user.id, brief));
    check("lease refused while held", !(await takeLease(user.id, brief)));
    const busyBefore = fitStats.leaseBusy;
    const whileHeld = await fitJobs(who, ids.slice(0, 2), { lease: true });
    check("a build while the lease is held judges nothing", whileHeld.size === 0 && fitStats.leaseBusy === busyBefore + 1);
    await releaseLease(user.id);
    check("lease taken again after release", await takeLease(user.id, brief));
    await releaseLease(user.id);

    const jobJudgements = await db.jobJudgement.count();
    const t0 = Date.now();
    const judgedBefore = fitStats.judged;
    const first = await fitJobs(who, ids.slice(0, 10), { lease: true, lane: "interactive" });
    const ms = Date.now() - t0;
    check("a build judges the 10 jobs", first.size === 10 && fitStats.judged - judgedBefore === 10, `${first.size} verdicts, ${ms} ms`);
    const rows = await db.fitJudgement.findMany({ where: { profileId: profile.id } });
    check("FitJudgement written per job", rows.length === 10);
    const readings = new Map((await db.job.findMany({ where: { id: { in: ids } }, select: { id: true, reading: true } })).map((r) => [r.id, (r.reading as { requirements: string[] }).requirements]));
    check("every stored evidence is one of the job's lines", rows.every((row) => row.evidenceIndex == null || (row.evidenceIndex >= 0 && row.evidenceIndex < readings.get(row.jobId)!.length)));
    check("every quote is that line", [...first].every(([id, v]) => v.quote == null || readings.get(id)!.includes(v.quote)));
    check("the lease is released after a build", (await db.candidateBrief.findUnique({ where: { userId: user.id } }))?.fitBuildUntil == null);
    for (const [id, v] of [...first].slice(0, 3)) console.log(`     ${v.fit.padEnd(7)} ${v.why} | ${v.quote ?? "-"} (${id.slice(-6)})`);

    const judgedMid = fitStats.judged;
    const second = await fitJobs(who, ids.slice(0, 10), { lease: true });
    check("a second build reads only", second.size === 10 && fitStats.judged === judgedMid && [...first].every(([id, v]) => second.get(id)?.fit === v.fit));
    check("judge: false reads the cache only", (await fitJobs(who, ids.slice(10), { judge: false })).size === 0);
    const single = await fitJobs(who, [ids[10]], { lease: false });
    check("a single job is judged without the lease", single.size === 1);
    const older = { ...who, brief: { ...brief, years: 9 } };
    check("a changed brief invalidates the cache", (await fitJobs(older, ids.slice(0, 10), { judge: false })).size === 0);
    check("JobJudgement never written", (await db.jobJudgement.count()) === jobJudgements);
  } finally {
    await deleteAccount(user.id).catch(() => undefined);
  }
  check("the user's FitJudgement rows go with the account", (await db.fitJudgement.count({ where: { profile: { userId: user.id } } })) === 0 && (await db.user.count({ where: { id: user.id } })) === 0);
}

async function main() {
  pure();
  await withDb();
  console.log(failed === 0 ? "fit-test PASS" : `fit-test FAIL (${failed})`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
