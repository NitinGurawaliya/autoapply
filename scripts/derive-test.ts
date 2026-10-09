// T54: answers derived from the profile and resume, with evidence; never for pay, notice, work authorization,
// sponsorship or EEO. Mostly offline; one live call checks the model's role picking. npx tsx scripts/derive-test.ts
import type { FormField } from "../src/modules/apply";
import { deriveAnswers, monthIndex, yearsIn } from "../src/modules/apply/derive";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const field = (label: string): FormField => ({ selector: `#${label.length}`, label, type: "text", required: true });
const junior = {
  country: "India",
  city: "Mohali",
  yearsExperience: 1,
  currentCompany: "Psquare Company",
  skills: ["React", "Node.js", "MongoDB"],
  experience: [
    { title: "MERN Stack Developer", company: "Psquare Company", start: "Jan 2026", end: "Apr 2026", summary: "Built React and Node.js features backed by MongoDB." },
    { title: "Full Stack Developer", company: "The Boring Education", start: "May 2025", end: "Dec 2025", summary: "Next.js and Postgres." },
  ],
};
const senior = {
  country: "India",
  city: "Mysuru",
  yearsExperience: 6,
  currentCompany: "Northwind Labs",
  skills: ["Python"],
  experience: [{ title: "Software Engineer", company: "Northwind Labs", start: "2020", end: "present", summary: "Python services on MongoDB and Redis; on-call for production incidents." }],
};

async function derive(profile: typeof junior | typeof senior, labels: string[]) {
  const found = await deriveAnswers({ profile, fields: labels.map(field) });
  return (label: string) => found.get(label);
}

async function main() {
  check("month names, ISO, slashes, years and 'present' parse", monthIndex("Jan 2026") === 2026 * 12 && monthIndex("June 2025") === 2025 * 12 + 5 && monthIndex("2023-01") === 2023 * 12 && monthIndex("01/2023") === 2023 * 12 && monthIndex("2020") === 2020 * 12 && monthIndex("present") !== null && monthIndex("sometime") === null);
  check("overlapping roles count once", Math.abs(yearsIn([{ title: "a", company: "x", start: "Jan 2020", end: "Dec 2021", summary: null }, { title: "b", company: "y", start: "Jan 2021", end: "Dec 2022", summary: null }]) - 3) < 0.01);

  const q = {
    usCanada: "Do you reside in the United States or Canada?",
    uk: "Are you currently living in the UK?",
    ni: "This role is open to all candidates across the wider UK, but to help us comply with monitoring & equality legislation, please let us know if you're currently residing in Northern Ireland?",
    india: "Do you currently live in India?",
    bangalore: "Are you based in Bangalore?",
    austin: "Are you currently located in Austin Texas or willing to relocate?",
    mongodb: "Have you ever worked at MongoDB before?",
    psquare: "Have you previously worked for Psquare?",
    government: "Have you ever been directly employed by any government or military entity?",
    okta: "Have you been employed by Okta, Inc. or any of its subsidiaries in the past?",
    linux: "Do you possess 3 years of experience in Linux OS?",
    fullstack8: "Do you have 8+ years of experience as a Full Stack Engineer?",
    salary: "What are your salary expectations?",
    auth: "Are you authorized to work in the United States?",
    gender: "What is your gender?",
  };
  const j = await derive(junior, Object.values(q));
  check("'reside in the US or Canada?' → No, from the profile's country", j(q.usCanada)?.answer === "No" && /India/.test(j(q.usCanada)?.basis ?? "") && j(q.usCanada)?.source === "derived", j(q.usCanada)?.basis);
  check("'currently living in the UK?' → No", j(q.uk)?.answer === "No");
  check("'residing in Northern Ireland?' → No for someone in India", j(q.ni)?.answer === "No");
  check("'live in India?' → Yes", j(q.india)?.answer === "Yes");
  check("'based in Bangalore?' is not settled by the country alone", j(q.bangalore) === undefined);
  check("a residence question mixed with relocation is left to the user", j(q.austin) === undefined);
  check("'worked at MongoDB?' → No, naming the resume's employers", j(q.mongodb)?.answer === "No" && /Psquare Company/.test(j(q.mongodb)?.basis ?? ""), j(q.mongodb)?.basis);
  check("'worked for Psquare?' → Yes", j(q.psquare)?.answer === "Yes", j(q.psquare)?.basis);
  check("'employed by any government entity' is not derived", j(q.government) === undefined);
  check("'employed by Okta, Inc. or any of its subsidiaries' → No", j(q.okta)?.answer === "No", j(q.okta)?.basis);
  check("'3 years of Linux' with 1 year in total → No", j(q.linux)?.answer === "No" && /1 years/.test(j(q.linux)?.basis ?? ""), j(q.linux)?.basis);
  check("'8+ years as a Full Stack Engineer' with 1 year in total → No", j(q.fullstack8)?.answer === "No");
  check("pay, work authorization and EEO are never derived", j(q.salary) === undefined && j(q.auth) === undefined && j(q.gender) === undefined);

  // Senior profile: "Yes" needs dated roles that involve the subject; the model may only point at roles.
  const python = "Do you have 3 years of experience in Python?";
  const nosql = "Do you possess 3 years of experience in NoSQL databases?";
  const rust = "Do you have 3 years of experience in Rust?";
  const s = await derive(senior, [python, nosql, rust]);
  check("'3 years of Python' → Yes from a dated role that mentions it", s(python)?.answer === "Yes" && /Northwind Labs/.test(s(python)?.basis ?? ""), s(python)?.basis);
  check("'3 years of NoSQL databases' → Yes via the model linking it to MongoDB", s(nosql)?.answer === "Yes", s(nosql)?.basis);
  check("'3 years of Rust' with no role involving it is left to the user", s(rust) === undefined, s(rust)?.basis);

  console.log(failed ? `FAIL derive (${failed})` : "PASS derive");
  process.exit(failed ? 1 : 0);
}

main();
