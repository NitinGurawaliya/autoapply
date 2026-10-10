// The feed now finds skills in Postgres (modules/jobs/match.ts feedRows) instead of downloading every description.
// This checks it gives exactly what scoreJob gives on the full text: (1) tricky skill spellings on a throwaway job,
// (2) for every real profile, the same 40 cards, in the same order, with the same scores and reasons, as the old
// download-everything feed. Read-only on real data; the throwaway user, company and job are removed at the end.
// npx tsx scripts/feed-sql-test.ts
import { db } from "../src/lib/db";
import { appliedRoleKeys, companyKey, loadRules, roleKey } from "../src/modules/governance";
import { companyResultsById, judge, listFeed, parseFeedFilters, scoreJob } from "../src/modules/jobs";
import { dedupeListings, feedRows } from "../src/modules/jobs/match";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const TRICKY = [
  "React", "react", " React ", "React.js", "Node.js", "node", "C/C++", "C++", "C#", "C", "Go", ".NET", "ASP.NET",
  "Machine Learning", "machine-learning", "Jest/Pytest", "Redux Toolkit (RTK Query)", "React Native", "Next.js",
  "OpenAI/Anthropic APIs", "SQL", "PostgreSQL", "k8s", "CI/CD", "^caret", "back\\slash", "a[b]", "x|y", "",
];
const TITLE = "Senior Software Engineer (React Native)";
const DESCRIPTION = [
  "We build with React.js and Node.js, plus some C/C++ and C#. Our ML team does machine learning; testing with Jest/Pytest.",
  "State lives in Redux Toolkit (RTK Query). Infra: k8s, CI/CD, PostgreSQL. Not ASP.NET, but .NET elsewhere: x.NET.",
  "Next.js frontends call OpenAI/Anthropic APIs. Go services. ^caret back\\slash a[b] x|y",
].join("\n");

// The same test as mentions() in match.ts.
function mentions(text: string, needle: string) {
  const escaped = needle.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return new RegExp(`(^|[^a-z0-9+#])${escaped}($|[^a-z0-9+#])`).test(text);
}

async function trickySkills() {
  const stamp = Date.now();
  const user = await db.user.create({ data: { email: `feed-sql-${stamp}@swipeapply.local`, name: "Feed SQL" } });
  const company = await db.company.create({ data: { source: "mock", slug: `feed-sql-${stamp}`, name: "Feed SQL Co" } });
  try {
    const job = await db.job.create({
      data: {
        source: "mock", externalId: `feed-sql-${stamp}`, companyId: company.id, title: TITLE, location: "Remote", country: "REMOTE", remoteType: "remote",
        experienceMin: null, description: DESCRIPTION, applyUrl: "http://localhost/mock", postedAt: new Date(), fetchedAt: new Date(), raw: {},
      },
    });
    const read = (skills: string[]) =>
      feedRows({ userId: user.id, sources: ["mock"], countries: ["REMOTE"], cutoff: new Date(Date.now() - 864e5), expMax: null, skills, titleWords: [], prefilter: false }).then((rows) => rows.find((r) => r.id === job.id));
    const row = await read(TRICKY);
    const sql = new Set(row?.hits ?? []);
    const js = new Set(TRICKY.map((skill, i) => (mentions(TITLE.toLowerCase(), skill) || mentions(DESCRIPTION.toLowerCase(), skill) ? i : -1)).filter((i) => i >= 0));
    const differ = TRICKY.filter((_, i) => sql.has(i) !== js.has(i));
    check("tricky skill spellings match exactly as in JavaScript", Boolean(row) && differ.length === 0, `differ: ${differ.join(" | ") || "none"}; ${js.size} of ${TRICKY.length} mentioned`);

    await db.job.update({ where: { id: job.id }, data: { description: "Only Rust here." } });
    const after = await read(["Rust", "React.js"]);
    check("the trigger refreshes a job's words when its description changes", JSON.stringify(after?.hits) === "[0]", JSON.stringify(after?.hits));
  } finally {
    await db.company.delete({ where: { id: company.id } });
    await db.user.delete({ where: { id: user.id } });
  }
}

/** The feed as it was computed before: every candidate job with its description, scored by scoreJob in JavaScript. */
async function referenceFeed(userId: string) {
  const filters = parseFeedFilters({});
  const [profile, answers, swipes] = await Promise.all([
    db.profile.findUnique({ where: { userId } }),
    db.answer.findMany({ where: { userId, key: "preferred_location" }, select: { answer: true } }),
    db.swipe.findMany({ where: { userId }, select: { jobId: true } }),
  ]);
  const skills = Array.isArray(profile?.skills) ? (profile.skills as string[]) : [];
  const preferred = (answers[0]?.answer ?? "").split(",").map((item) => item.trim()).filter((item) => item === "India" || item === "US" || item === "Other");
  const sources = profile?.isTest ? [...new Set([...filters.boards, "mock"])] : filters.boards;
  const [jobs, applied, results] = await Promise.all([
    db.job.findMany({
      where: { source: { in: sources }, country: { in: filters.countries }, postedAt: { gte: new Date(Date.now() - filters.days * 864e5) }, closedAt: null, id: { notIn: swipes.map((s) => s.jobId) } },
      include: { company: { select: { name: true } } },
      orderBy: { id: "asc" }, // the same order feedRows reads, so ties break the same way
    }),
    appliedRoleKeys(userId),
    companyResultsById().catch(() => new Map<string, never>()),
  ]);
  const minScore = loadRules().min_match_score;
  const scored = jobs
    .map((job) => {
      const match = scoreJob(job, { currentTitle: profile?.currentTitle ?? null, skills, yearsExperience: profile?.yearsExperience ?? null, preferredLocations: preferred });
      const daysAgo = Math.max(0, Math.floor((Date.now() - job.postedAt.getTime()) / 864e5));
      return {
        id: job.id, location: job.location, source: job.source, daysAgo, score: match.score, reason: match.reason, skillHits: match.skillHits.slice(0, 4),
        roleKey: roleKey(companyKey(job.company.name), job.title), verdict: judge(results.get(job.companyId)), mock: job.source === "mock",
      };
    })
    .filter((job) => job.mock || job.score >= minScore)
    .filter((job) => !applied.has(job.roleKey));
  return dedupeListings(scored)
    .map((job) => ({ ...job, rank: job.score + job.verdict.nudge }))
    .sort((a, b) => b.rank - a.rank || b.score - a.score || a.daysAgo - b.daysAgo)
    .slice(0, 40);
}

async function realProfiles() {
  const profiles = await db.profile.findMany({ select: { userId: true, isTest: true } });
  for (const { userId, isTest } of profiles) {
    if (isTest) continue;
    const t0 = Date.now();
    const reference = await referenceFeed(userId);
    const t1 = Date.now();
    const feed = await listFeed(userId, parseFeedFilters({}));
    const t2 = Date.now();
    const differs = (i: number) => {
      const a = reference[i];
      const b = feed[i];
      return !a || !b || a.id !== b.id || a.score !== b.score || a.reason !== b.reason || JSON.stringify(a.skillHits) !== JSON.stringify(b.skillHits);
    };
    const first = [...Array(Math.max(reference.length, feed.length)).keys()].find(differs);
    check(
      `user …${userId.slice(-6)}: same ${reference.length} cards, order, scores and reasons`,
      first === undefined,
      `old ${t1 - t0} ms, new ${t2 - t1} ms${first === undefined ? "" : `; first difference at ${first}: ${JSON.stringify(reference[first])} vs ${JSON.stringify(feed[first])}`}`,
    );
  }
}

async function main() {
  await trickySkills();
  await realProfiles();
  console.log(failed ? `FAIL feed-sql (${failed})` : "PASS feed-sql");
  process.exit(failed ? 1 : 0);
}

main().finally(() => db.$disconnect());
