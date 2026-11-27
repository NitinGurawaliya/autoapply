// One judgement of a job against a profile (src/modules/jobs/profile-fit.ts, docs/feed/TDD.md 4.2, X2). Pure: no
// network, no database. npx tsx scripts/profile-fit-test.ts
import { profileFit, type FitJob, type FitProfile } from "../src/modules/jobs/profile-fit";

let failed = 0;
function ok(name: string, pass: boolean, detail = "") {
  if (!pass) failed += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const nitin: FitProfile = { tracks: ["ml_ai", "fullstack", "backend", "frontend"], showNearby: false, avoid: ["intern"], yearsExperience: 1, shows: new Set(["python", "react", "node.js"]) };
const job = (patch: Partial<FitJob>): FitJob => ({ source: "greenhouse", title: "Backend Engineer", track: "backend", seniority: null, experienceMin: 1, skills: [], skillsRequired: null, ...patch });
const fit = (patch: Partial<FitJob>, score: number | null = 70, who: FitProfile = nitin, extra: { verdictNo?: boolean; verdictReason?: string } = {}) => profileFit(job(patch), who, { score, minScore: 40, ...extra });

const good = fit({});
ok("a job in their field, years and level, scoring 70, matches with no reasons", good.matches && !good.hard && good.reasons.length === 0);

const years = fit({ experienceMin: 5 });
ok("asks more years than they reach: hard, with the years in words", !years.matches && years.hard && years.reasons[0] === "Asks 5+ years: you have 1 year", years.reasons.join(" | "));
ok("asks their reach (years + 1) still matches", fit({ experienceMin: 2 }).matches);

const senior = fit({ seniority: "senior", experienceMin: null });
ok("a senior role for 1 year: hard, named", senior.hard && senior.reasons[0] === "Senior role: you have 1 year", senior.reasons.join(" | "));
const intern = fit({ seniority: "intern" }, 70, { ...nitin, avoid: [], yearsExperience: 4 });
ok("an internship for 4 years: below their level", intern.hard && intern.reasons[0] === "Internship: you have 4 years", intern.reasons.join(" | "));

const field = fit({ title: "Data Scientist", track: "data_science" });
ok("outside their fields: hard, with the field's name", field.hard && field.reasons[0] === "Data science & analytics: not one of your fields", field.reasons.join(" | "));
ok("plain software roles count for developers", fit({ title: "Software Engineer", track: "software" }).matches);
ok("a nearby field counts when they asked for nearby fields", fit({ title: "Data Engineer", track: "data_engineering" }, 70, { ...nitin, showNearby: true }).matches);

const avoided = fit({ title: "AI Engineer Intern", track: "ml_ai", seniority: "intern" });
ok("an internship when they said never show: hard, said so", avoided.hard && avoided.reasons[0] === "Internship: you said never show these", avoided.reasons.join(" | "));
ok("a non-tech role: hard", fit({ title: "Account Executive", track: null, roleFamily: "non_tech", readingCurrent: true }).hard);

const skills = fit({ skills: ["go", "kubernetes", "python", "docker"], skillsRequired: ["go", "kubernetes", "python"] }, 30);
ok("missing required skills are named (at most three), weak score does not match", !skills.matches && !skills.hard && skills.reasons[0] === "Asks go, kubernetes", skills.reasons.join(" | "));
const weak = fit({}, 32);
ok("a weak score alone says so", !weak.matches && !weak.hard && weak.reasons[0] === "Weak match (32)");
ok("exactly the minimum matches", fit({}, 40).matches);
const no = fit({}, 0, nitin, { verdictNo: true, verdictReason: "The role is mostly sales support" });
ok("the model's 'no' gives its own reason", !no.matches && no.reasons.includes("The role is mostly sales support"), no.reasons.join(" | "));
ok("an unknown score lets the rules decide (Apply still runs the swipe check)", fit({}, null).matches && !fit({ experienceMin: 5 }, null).matches);
ok("several reasons keep the most decisive first", fit({ title: "Senior Data Scientist", track: "data_science", seniority: "senior", experienceMin: 6 }).reasons[0].includes("not one of your fields"));
ok("no years given: the years reason leaves out 'you have'", fit({ experienceMin: 5 }, 70, { ...nitin, yearsExperience: null }).reasons[0] === "Asks 5+ years");
ok("mock jobs always pass the gate", fit({ source: "mock", title: "Data Scientist", track: "data_science" }).reasons.every((reason) => !reason.includes("not one of your fields")));

console.log(failed === 0 ? "PASS profile-fit-test" : `FAIL profile-fit-test (${failed})`);
process.exit(failed === 0 ? 0 : 1);
