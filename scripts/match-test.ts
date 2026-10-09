// Offline checks for experience parsing and match scoring. npx tsx scripts/match-test.ts
import { scoreJob } from "../src/modules/jobs";
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

console.log(failed === 0 ? "PASS match logic" : `FAIL match logic (${failed})`);
process.exit(failed === 0 ? 0 : 1);
