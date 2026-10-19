// Offline checks for experience parsing and match scoring. npx tsx scripts/match-test.ts
import { scoreJob, tierOf } from "../src/modules/jobs";
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
check("2 yr ask is ok but below entry", twoYr.score >= 40 && twoYr.score <= entry.score, `${twoYr.score}%`);
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
console.log(failed === 0 ? "PASS match logic" : `FAIL match logic (${failed})`);
process.exit(failed === 0 ? 0 : 1);
