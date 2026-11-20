// Phase M4: the score breakdown always adds up to the score, and the skills comparison never calls a skill the
// candidate shows "missing". Fixtures offline, then every real profile's feed. npx tsx scripts/score-breakdown-test.ts
import { db } from "../src/lib/db";
import { listFeed, parseFeedFilters, scoreJob } from "../src/modules/jobs";
import type { Breakdown } from "../src/modules/jobs/match";
import { candidateShows } from "../src/modules/jobs/skills";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const total = (b: Breakdown) => b.parts.reduce((sum, part) => sum + part.points, 0) + b.adjustments.reduce((sum, a) => sum + a.effect, 0);
const adds = (score: number, b: Breakdown) => (b.parts.length === 0 ? score === 0 : total(b) === score);
const within = (b: Breakdown) => b.parts.every((part) => part.points >= 0 && part.points <= part.max);

const dev = { currentTitle: "Full Stack Developer", skills: ["React", "Node.js", "MongoDB", "Express", "JavaScript", "TypeScript", "HTML", "CSS"], yearsExperience: 1, preferredLocations: ["India"], tracks: ["fullstack", "frontend", "backend"] };
const base = { country: "IN", remoteType: "unknown", experienceMin: null as number | null };
const stack = "We use React, Node.js, MongoDB, Express, JavaScript, TypeScript, HTML and CSS.";
const cases = {
  "by tracks, fits": scoreJob({ ...base, title: "Full Stack Engineer React", description: `${stack} 0-2 years of experience.` }, dev),
  "by tracks, over 100 before the cap": scoreJob({ ...base, title: "React Node.js JavaScript Full Stack Developer", description: `${stack} 0-1 years of experience.` }, { ...dev, skills: dev.skills.slice(0, 4) }),
  "by tracks, unstated years": scoreJob({ ...base, title: "Full Stack Developer", description: stack }, dev),
  "by meaning, strong verdict": scoreJob({ ...base, title: "Software Engineer", description: `${stack} 0-1 years of experience.`, similarity: 0.42, judgement: { fit: "strong", why: "test" } }, dev),
  "by meaning, unjudged": scoreJob({ ...base, title: "Software Engineer", description: `${stack} 0-1 years.`, similarity: 0.55, judgement: null }, dev),
  "by meaning, unstated": scoreJob({ ...base, title: "Software Engineer", description: stack, similarity: 0.6, judgement: { fit: "strong", why: "test" } }, dev),
  "abroad, no place match": scoreJob({ ...base, country: "US", title: "Frontend Engineer", description: `${stack} 0-1 years.` }, dev),
  "out of band": scoreJob({ ...base, title: "Senior Software Engineer", description: `${stack} 5+ years.` }, dev),
};
for (const [name, result] of Object.entries(cases)) {
  const b = result.breakdown;
  check(`${name}: parts and caps add up`, adds(result.score, b), `${result.score} = ${b.parts.map((p) => `${p.key} ${p.points}/${p.max}`).join(" + ")}${b.adjustments.map((a) => ` ${a.effect >= 0 ? "+" : ""}${a.effect} ${a.key}`).join("")}`);
  check(`${name}: each part within its max`, within(b));
}
check("over 100 shows a ceiling adjustment", cases["by tracks, over 100 before the cap"].breakdown.adjustments.some((a) => a.key === "ceiling") || total({ parts: cases["by tracks, over 100 before the cap"].breakdown.parts, adjustments: [] }) <= 100);
check("unstated years shows the 74 cap when it bites", cases["by meaning, unstated"].score <= 74 && (cases["by meaning, unstated"].breakdown.adjustments.some((a) => a.key === "unstated_cap") || total({ parts: cases["by meaning, unstated"].breakdown.parts, adjustments: [] }) <= 74));
check("a strong verdict floor is listed when it raises the score", cases["by meaning, strong verdict"].score >= 75 && adds(cases["by meaning, strong verdict"].score, cases["by meaning, strong verdict"].breakdown));
check("out of band has no parts and scores 0", cases["out of band"].score === 0 && cases["out of band"].breakdown.parts.length === 0);

async function realFeeds() {
  const profiles = await db.profile.findMany({ select: { userId: true, skills: true, resumeText: true, isTest: true } });
  let jobs = 0;
  let bad = 0;
  let wrongMissing = 0;
  let notInJob = 0;
  let split = 0;
  let withSkills = 0;
  let withPay = 0;
  for (const profile of profiles) {
    const feed = await listFeed(profile.userId, parseFeedFilters({}));
    const shows = candidateShows(profile);
    for (const job of feed) {
      jobs += 1;
      if (!adds(job.score, job.breakdown) || !within(job.breakdown)) {
        bad += 1;
        if (bad <= 3) console.log(`  bad breakdown: ${job.title} ${job.score} vs ${total(job.breakdown)}`);
      }
      if (job.skills.missing.some((skill) => shows.has(skill)) || job.skills.have.some((skill) => !shows.has(skill))) wrongMissing += 1;
      if (job.skills.have.length + job.skills.missing.length > job.skills.total) notInJob += 1;
      if (job.skills.split) split += 1;
      if (job.skills.total > 0) withSkills += 1;
      if (job.salary) withPay += 1;
    }
  }
  check(`real feeds: every breakdown adds up (${jobs} cards, ${profiles.length} profiles)`, jobs > 0 && bad === 0, `${bad} bad`);
  check("real feeds: no missing skill the candidate shows, no 'have' they don't", wrongMissing === 0, `${wrongMissing} wrong`);
  check("real feeds: have + missing never exceed the job's own skills", notInJob === 0);
  console.log(`  ${withSkills}/${jobs} cards with skills, ${split} with required labels, ${withPay} with pay`);
}

realFeeds()
  .then(async () => {
    await db.$disconnect();
    console.log(`${failed === 0 ? "PASS" : "FAIL"} score-breakdown-test`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
