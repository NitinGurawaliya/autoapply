// The feed now finds skills in Postgres (modules/jobs/match.ts feedRows) instead of downloading every description.
// This checks it gives exactly what scoreJob gives on the full text: (1) tricky skill spellings on a throwaway job,
// (2) for every real profile, the same 40 cards, in the same order, with the same scores and reasons, as the old
// download-everything feed. Read-only on real data; the throwaway user, company and job are removed at the end.
// npx tsx scripts/feed-sql-test.ts
import { db } from "../src/lib/db";
import { companyKey, feedHistory, loadRules, roleKey } from "../src/modules/governance";
import { ADJACENT_TRACKS, companyResultsById, judge, judgeJobs, listFeed, parseFeedFilters, profileVector, scoreJob, tracksOf } from "../src/modules/jobs";
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
      feedRows({ userId: user.id, sources: ["mock"], countries: ["REMOTE"], levelYears: null, stages: null, tracks: null, vector: null, cutoff: new Date(Date.now() - 864e5), expMax: null, skills, titleWords: [], prefilter: false }).then((rows) => rows.find((r) => r.id === job.id));
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
  const tracks = profile ? tracksOf(profile) : [];
  const reachable = [...new Set([...tracks, ...tracks.flatMap((track) => ADJACENT_TRACKS[track as keyof typeof ADJACENT_TRACKS] ?? [])])];
  // With the resume's vector, closeness by meaning and the model's verdict decide the field; without, the tracks.
  const vector = profile ? await profileVector(profile) : null;
  const [jobs, history, results] = await Promise.all([
    db.job.findMany({
      // India and remote-from-India by default (T80).
      where: { source: { in: sources }, eligibility: { in: ["india", "remote_india"] }, ...(tracks.length > 0 && !vector ? { track: { in: reachable } } : {}), postedAt: { gte: new Date(Date.now() - filters.days * 864e5) }, closedAt: null, id: { notIn: swipes.map((s) => s.jobId) } },
      include: { company: { select: { name: true } } },
      orderBy: { id: "asc" }, // the same order feedRows reads, so ties break the same way
    }),
    feedHistory(userId, loadRules().max_per_company_per_week),
    companyResultsById().catch(() => new Map<string, never>()),
  ]);
  const minScore = loadRules().min_match_score;
  // Each job's closeness, one query; then the same shortlist the feed judges (the 150 closest still open to apply).
  const sims = new Map<string, number>();
  if (vector) {
    const rows = await db.$queryRaw<Array<{ id: string; s: number }>>`
      SELECT id, (1 - (embedding <=> ${vector}::halfvec))::float8 AS s FROM "Job" WHERE id = ANY(${jobs.map((job) => job.id)}::text[]) AND embedding IS NOT NULL`;
    for (const row of rows) sims.set(row.id, row.s);
  }
  const open = (job: (typeof jobs)[number]) => !history.roles.has(roleKey(companyKey(job.company.name), job.title)) && !history.companiesAtCap.has(companyKey(job.company.name));
  const closest = jobs
    .filter((job) => sims.has(job.id) && sims.get(job.id)! >= 0.35 && job.source !== "mock" && open(job))
    .sort((a, b) => sims.get(b.id)! - sims.get(a.id)! || (a.id < b.id ? -1 : 1));
  // The same widening as the feed: 150 closest, then 150 more while fewer than 40 cards remain, up to 450.
  let kept = new Set<string>();
  let verdicts = new Map();
  let scored: ReturnType<typeof scoreAll> = [];
  for (let limit = 150; ; limit += 150) {
    const shortlist = closest.slice(0, limit);
    kept = new Set(shortlist.map((job) => job.id));
    verdicts = profile && shortlist.length ? await judgeJobs(profile, shortlist) : new Map();
    scored = scoreAll();
    if (scored.length >= 40 || limit >= closest.length || limit >= 450) break;
  }
  function scoreAll() {
    return jobs
    .filter((job) => !sims.has(job.id) || (sims.get(job.id)! >= 0.35 && kept.has(job.id)))
    .map((job) => {
      const match = scoreJob({ ...job, similarity: sims.get(job.id) ?? null, judgement: verdicts.get(job.id) ?? null }, { currentTitle: profile?.currentTitle ?? null, skills, yearsExperience: profile?.yearsExperience ?? null, preferredLocations: preferred, tracks });
      const daysAgo = Math.max(0, Math.floor((Date.now() - job.postedAt.getTime()) / 864e5));
      return {
        id: job.id, company: job.company.name, location: job.location, source: job.source, daysAgo, score: match.score, reason: match.reason, skillHits: match.skillHits.slice(0, 4),
        roleKey: roleKey(companyKey(job.company.name), job.title), verdict: judge(results.get(job.companyId)), mock: job.source === "mock",
      };
    })
    .filter((job) => job.mock || job.score >= minScore)
    .filter((job) => !history.roles.has(job.roleKey))
    .filter((job) => !history.companiesAtCap.has(companyKey(job.company)));
  }
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
