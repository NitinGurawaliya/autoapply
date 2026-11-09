// Offline checks for experience parsing and match scoring. npx tsx scripts/match-test.ts
import { scoreJob, tierOf } from "../src/modules/jobs";
import { classifyTitle } from "../src/modules/jobs/functions";
import { bandMiss, feedTracks, levelsFor, scoreFeatures, yearsBand } from "../src/modules/jobs/match";
import { trackFloor } from "../src/modules/jobs/semantic";
import { requiredYears, titleYears } from "../src/modules/jobs/tagging";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

check("senior title ~5", titleYears("Senior Software Engineer") === 5);
check("intern title 0", requiredYears("Software Engineer Intern", "4+ years of experience") === 0);
check("Engineer III ~5", titleYears("Engineer III") === 5);
check("Engineer II ~2", titleYears("Software Engineer II") === 2);
check("Engineer I 0", titleYears("Software Engineer I") === 0);
check("staff 8", titleYears("Staff Software Engineer") === 8);
check("5+ years of experience", requiredYears("Software Engineer", "You have 5+ years of experience in backend.") === 5);
check("3-5 years lower bound", requiredYears("Software Engineer", "3-5 years of professional experience") === 3);
check("0-2 years", requiredYears("Software Engineer", "0-2 years of experience") === 0);
check("minimum 4 years", requiredYears("Backend Engineer", "Minimum 4 years building APIs.") === 4);
check("experience of 6 years", requiredYears("Backend Engineer", "Relevant experience of at least 6 years") === 6);
check("no info is unknown", requiredYears("Software Engineer", "Join our team and build great things.") === null);

const junior = {
  currentTitle: "MERN Stack Developer",
  skills: ["React", "Node.js", "MongoDB", "Express", "JavaScript", "TypeScript", "HTML", "CSS"],
  yearsExperience: 1,
  preferredLocations: [],
};
const base = { country: "IN", remoteType: "unknown", experienceMin: null as number | null };
const stack = "We use React, Node.js, MongoDB, Express, JavaScript, TypeScript, HTML and CSS.";

const senior = scoreJob({ ...base, title: "Senior Software Engineer", description: `${stack} 5+ years of experience required.` }, junior);
const four = scoreJob({ ...base, title: "Software Engineer", description: `${stack} Minimum 4 years of experience.` }, junior);
const entry = scoreJob({ ...base, title: "Software Engineer", description: `${stack} 0-2 years of experience.` }, junior);
const grad = scoreJob({ ...base, title: "Graduate Developer", description: stack }, junior);
const twoYr = scoreJob({ ...base, title: "Software Engineer", description: `${stack} 2+ years of experience.` }, junior);

check("senior role for 1 yr dev stays under 40", senior.score < 40, `${senior.score}%`);
check("4 yr role stays under 40", four.score < 40, `${four.score}%`);
check("entry role scores well", entry.score >= 60, `${entry.score}%`);
check("graduate role scores well", grad.score >= 60, `${grad.score}%`);
// Strict matching (9 Nov): a job asking more years than the candidate has is out, not a capped Stretch.
check("2 yr ask is out for a 1 yr dev", twoYr.score === 0 && /2\+ years/.test(twoYr.reason), `${twoYr.score}% ${twoYr.reason}`);
check("reason explains seniority", /years/i.test(senior.reason), senior.reason);

// T82: tiers, by tracks (no vectors) and by meaning plus the model's verdict (semantic.ts).
const dev = { ...junior, tracks: ["fullstack", "frontend", "backend"] };
const ds = { currentTitle: "Data Scientist", skills: ["Python", "Pandas", "SQL", "Statistics"], yearsExperience: 2, preferredLocations: [], tracks: ["data_science"] };
const tracked = (title: string, description: string, who: typeof dev | typeof ds) => scoreJob({ ...base, title, description }, who);
check("by tracks: an entry full-stack role for a 1-yr MERN dev is strong or good", ["strong", "good"].includes(tierOf(tracked("Full Stack Engineer", `${stack} 0-2 years of experience.`, dev).score, 40) ?? ""), String(tracked("Full Stack Engineer", `${stack} 0-2 years.`, dev).score));
check("by tracks: a frontend role is not shown to a data scientist", tracked("Senior Frontend Engineer", "React and CSS.", ds).score === 0);
check("by tracks: a sales role is not shown to a developer", tracked("Account Executive", "Sell our product.", dev).score === 0);
check("by tracks: a data scientist sees data science roles", (tierOf(tracked("Data Scientist", "Python, SQL, Pandas and statistics. 2+ years of experience.", ds).score, 40) ?? "") !== "");
const meaning = (similarity: number, fit: "strong" | "good" | "stretch" | "no" | null, extra: Partial<{ title: string; description: string }> = {}) =>
  scoreJob({ ...base, title: extra.title ?? "Software Engineer", description: extra.description ?? `${stack} 0-2 years of experience.`, similarity, judgement: fit ? { fit, why: "test" } : null }, dev);
check("by meaning: close and judged strong → strong", tierOf(meaning(0.6, "strong").score, 40) === "strong", String(meaning(0.6, "strong").score));
check("by meaning: judged no → out, whatever the closeness", meaning(0.65, "no").score === 0);
check("by meaning: below the floor → out", meaning(0.3, "good").score === 0);
check("by meaning: unjudged needs to be closer", meaning(0.4, null).score === 0 && meaning(0.5, null).score > 0);
check("by meaning: a senior role for a 1-yr dev stays low even if close", meaning(0.6, "stretch", { title: "Senior Software Engineer", description: `${stack} 5+ years of experience required.` }).score < 40);
const intern = { title: "SDE Intern - Backend", description: "Backend services in Go and SQL. Our story: awards, funding rounds and offices." };
check("by meaning: a good verdict on an intern role that fits is not Stretch, even when far by meaning", tierOf(meaning(0.39, "good", intern).score, 40) === "good", String(meaning(0.39, "good", intern).score));
check("by meaning: a strong verdict that fits is strong", tierOf(meaning(0.38, "strong", intern).score, 40) === "strong", String(meaning(0.38, "strong", intern).score));
check("by meaning: the floor does not lift a job asking more years", tierOf(meaning(0.39, "good", { description: `${stack} 3+ years of experience.` }).score, 40) !== "good", String(meaning(0.39, "good", { description: `${stack} 3+ years of experience.` }).score));
check("by meaning: the verdict's reason is shown", /^Test/.test(meaning(0.6, "strong").reason), meaning(0.6, "strong").reason);

// 19 Oct: the model called frontend, backend and full-stack roles "different" for a full-stack developer; the title's track sets a floor.
const web = ["fullstack", "backend", "frontend"];
check("track floor: a frontend role is at least close for a full-stack developer", trackFloor("Software Engineer II, Frontend (Bangalore, India)", web).field === "close", trackFloor("Software Engineer II, Frontend (Bangalore, India)", web).field);
check("track floor: a full-stack role is at least close", trackFloor("Platform Engineer - Full Stack (UI Centric)", web).field === "close", trackFloor("Platform Engineer - Full Stack (UI Centric)", web).field);
check("track floor: a plain Software Engineer is related for a web developer, not close", trackFloor("Software Engineer", web).field === "related", trackFloor("Software Engineer", web).field);
check("track floor: a mobile role is at least related for a frontend developer", trackFloor("Android Developer", ["frontend"]).field === "related", trackFloor("Android Developer", ["frontend"]).field);
check("track floor: sales and recruiting get no floor", trackFloor("Account Executive", web).field === "different" && trackFloor("Technical Recruiter", web).field === "different");
check("track floor: a data scientist gets no floor on a frontend role", trackFloor("Frontend Engineer", ["data_science"]).field === "different", trackFloor("Frontend Engineer", ["data_science"]).field);
// Strict matching (9 Nov, owner: "only exact matches"): the cards the feed audit found off-target, as cases.
// Real titles from the owner's and Nitin's feeds (scripts/feed-audit.ts, before the change).
const nitin = { ...dev, yearsExperience: 1, tracks: ["ml_ai", "fullstack", "backend", "frontend", "software"] };
const fresher = { ...dev, yearsExperience: 0 };
const owner = { ...dev, yearsExperience: null, tracks: ["fullstack", "backend", "frontend"] };
const judged = (title: string, description: string, who: typeof dev | typeof owner, fit: "strong" | "good" | "stretch" = "good", similarity = 0.62) =>
  scoreJob({ ...base, title, description, similarity, judgement: { fit, why: "test" } }, who);
check("strict: SDE II for a 1-yr dev is out, even judged good and close", judged("SDE II - Python Engineer", stack, nitin).score === 0, judged("SDE II - Python Engineer", stack, nitin).reason);
check("strict: Software Engineer II for a 1-yr dev is out", judged("Software Engineer II", stack, nitin, "strong", 0.7).score === 0);
check("strict: Software Development Engineer 2 (SDE 2) for a fresher is out", judged("Software Development Engineer 2 (SDE 2)", stack, fresher).score === 0);
check("strict: a 3-year ask for a 1-yr dev is out", judged("Software Engineer 1", `${stack} 3+ years of experience.`, nitin, "stretch").score === 0);
check("strict: a 2-year ask for the owner (years unknown = fresher) is out", judged("Software Engineer", `${stack} 2+ years of experience.`, owner, "stretch").score === 0);
check("strict: a 1-year ask for a fresher stays", judged("Frontend Developer", `${stack} 1+ years of experience.`, fresher).score >= 40);
check("strict: a stated mid level with no years is out for a 1-yr dev", scoreFeatures({ title: "Engineer", seniority: "mid", requiredYears: null, country: "IN", remoteType: "unknown", skillHits: [], similarity: 0.6, judgement: { fit: "strong", why: "t" } }, nitin).score === 0);
check("strict: Senior for 3 years is out, for 5 it stays", judged("Senior Software Engineer", stack, { ...nitin, yearsExperience: 3 }).score === 0 && judged("Senior Software Engineer", stack, { ...nitin, yearsExperience: 5 }).score >= 40);
check("strict: SDE II for 2 years stays", judged("SDE II - Python Engineer", stack, { ...nitin, yearsExperience: 2 }).score >= 40);
check("strict: an intern role is out from 3 years", judged("Software Engineer Intern", stack, { ...nitin, yearsExperience: 3 }).score === 0);
check("strict: an intern role stays for a fresher", tierOf(judged("Full Stack Development Intern", stack, fresher, "strong").score, 40) === "strong");
const unstated = judged("React Engineer", stack, nitin, "strong", 0.7);
check("strict: a job stating neither years nor level is never Strong", unstated.score > 0 && tierOf(unstated.score, 40) === "good", String(unstated.score));
check("strict: bandMiss says why", bandMiss({ requiredYears: 2, seniority: "mid" }, 1) === "They want about 2+ years; you have 1" && bandMiss({ requiredYears: null, seniority: "senior" }, 1) === "A senior role, above your experience");
check("strict: years band", [yearsBand(0), yearsBand(1), yearsBand(1.9), yearsBand(3), yearsBand(null)].join() === "1,1,1,3,1");
check("strict: levels for a 1-yr dev are intern and entry", levelsFor(1).join() === "intern,entry", levelsFor(1).join());
check("strict: levels for 6 years", levelsFor(6).join() === "mid,senior,staff,manager", levelsFor(6).join());
check("strict: a web developer's feed tracks are their own plus plain software", feedTracks(["fullstack", "backend", "frontend"])?.join() === "fullstack,backend,frontend,software");
check("strict: data engineering, DevOps, mobile and solutions are not in a web developer's feed", !["data_engineering", "devops", "mobile", "solutions"].some((t) => feedTracks(["fullstack", "backend", "frontend"])!.includes(t)));
check("strict: a data scientist's feed has no plain software roles", feedTracks(["data_science"])?.join() === "data_science");
check("strict: a profile without tracks has no track gate", feedTracks([]) === null);
check("titles: SDE1-Java is software", classifyTitle("SDE1-Java").track === "software");
check("titles: a mechanical engineering internship is not software", classifyTitle("Mechanical Engineer - Internship").track === null);
check("titles: trainers and tool admins are not tech", classifyTitle("Intern - Tech Trainer (Jan 2027 Batch)").track === null && classifyTitle("AI Tool Admin").track === null);
const notSoftware = ["Junior Metallurgist / Engineer", "Manufacturing Engineer", "Structural Design and Analysis Engineer", "Junior Sourcing Engineer", "Junior/Trainee Engineer- Electrical", "AI Filmmaker", "Management Trainee - AI Operations", "Associate Engineer, Manufacturing"];
check("titles: other engineering disciplines are not software", notSoftware.every((t) => classifyTitle(t).track === null), notSoftware.filter((t) => classifyTitle(t).track !== null).join(" | "));
const stillSoftware = ["Software Engineer, Manufacturing Infrastructure", "Sr. Software Engineer - Manufacturing Data & Test Infrastructure", "Senior Solutions Engineer (Manufacturing, Automotive, Defence)", "Product Engineer (Mobile)"];
check("titles: software roles in manufacturing stay tech", stillSoftware.every((t) => classifyTitle(t).track !== null), stillSoftware.filter((t) => classifyTitle(t).track === null).join(" | "));
console.log(failed === 0 ? "PASS match logic" : `FAIL match logic (${failed})`);
process.exit(failed === 0 ? 0 : 1);
