// The agent answers what the candidate's data already settles (modules/apply/infer.ts, 30 Oct), with the real model, on
// a synthetic profile and answer bank (a throwaway user, removed at the end, since candidates come from the database): obvious questions are answered with their evidence, and the hard rules hold
// (nothing invented, sensitive answers only from the user's own words, the same country on both sides).
// npx tsx scripts/infer-test.ts
import { db } from "../src/lib/db";
import { deleteAccount } from "../src/modules/account";
import type { FormField } from "../src/modules/apply";
import { inferAnswers } from "../src/modules/apply/infer";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const profile = {
  city: "Bengaluru", country: "India", yearsExperience: 2, currentTitle: "Software Engineer", currentCompany: "Acme Labs",
  linkedin: "https://www.linkedin.com/in/test-person/", github: null, portfolio: null,
  skills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
  experience: [{ title: "Software Engineer", company: "Acme Labs", start: "Jul 2024", end: "present" }],
  education: [{ school: "PES University", degree: "B.Tech Computer Science", year: "2024" }],
};
const at = (day: string) => new Date(`2026-10-${day}T10:00:00Z`);
const answers = [
  { key: "expected_ctc", question: "Expected CTC", answer: "18", source: "user", updatedAt: at("01") },
  { key: "current_ctc", question: "Current CTC", answer: "12", source: "user", updatedAt: at("01") },
  { key: "notice_period", question: "Notice period", answer: "30", source: "user", updatedAt: at("01") },
  { key: "q_000000000001", question: "How did you learn about this job?", answer: "LinkedIn", source: "user", updatedAt: at("20") },
  { key: "q_000000000002", question: "Are you legally authorized to work in India?", answer: "Yes", source: "user", updatedAt: at("12"), context: { company: "Razorpay", country: "IN", location: "Bengaluru" } },
  { key: "q_000000000003", question: "Do you need visa sponsorship to work in the United States?", answer: "Yes", source: "user", updatedAt: at("12"), context: { company: "Stripe", country: "US", location: "San Francisco" } },
  // Traps from the 30 Oct replay: look-alikes that are other facts.
  { key: "q_000000000004", question: "Address Line 1", answer: "12 MG Road", source: "user", updatedAt: at("14") },
  { key: "q_000000000005", question: "Codeforces Rating", answer: "1500", source: "user", updatedAt: at("14") },
];
const q = {
  heard: "How did you hear about this opportunity?",
  salary: "What are your salary expectations?",
  adult: "Are you over the age of 18?",
  city: "Which city are you currently based in?",
  location: "Where are you currently located?",
  notice: "How soon can you join (notice period)?",
  authIndia: "Are you legally authorized to work in the country where this role is based?",
  sponsorIndia: "Will you require visa sponsorship to work in the country where this role is based?",
  zip: "Post Code",
  remote: "Are you willing to work from our office 5 days a week?",
  linkedin: "LinkedIn profile URL",
  codechef: "Codechef Rating",
  teach: "Show us how you teach through code:",
};
const fields: FormField[] = Object.values(q).map((label, i) => ({ selector: `#f${i}`, label, type: "text", required: true }));

async function main() {
  const user = await db.user.create({ data: { email: `infer-test-${Date.now()}@swipeapply.local`, name: "Infer Test" } });
  try {
    await db.answer.createMany({ data: answers.map(({ updatedAt, context, ...row }) => ({ ...row, userId: user.id, updatedAt, ...(context ? { context } : {}) })) });
    await run(user.id);
  } finally {
    await deleteAccount(user.id);
  }
  console.log(failed === 0 ? "PASS infer" : `FAIL infer (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

async function run(userId: string) {
  const { answers: found, rejected } = await inferAnswers({ userId, fields, answers, profile, job: { company: "Zeta", title: "Backend Engineer", location: "Bengaluru, India", country: "IN" } });
  const a = (label: string) => found.get(label);
  for (const [label, value] of found) console.log(`     ${label} → ${value.answer} [${value.source}] ${value.basis.slice(0, 110)}`);
  for (const line of rejected) console.log(`     refused: ${line}`);

  check("how you heard is your answer to another wording", a(q.heard)?.answer === "LinkedIn" && a(q.heard)?.source === "matched");
  check("salary expectations come from the expected CTC (18)", /\b18\b/.test(a(q.salary)?.answer ?? ""), a(q.salary)?.answer);
  check("over 18 from a finished degree or work", /^yes/i.test(a(q.adult)?.answer ?? ""), a(q.adult)?.answer);
  // "Where located" may also be asked: the double-check does not always confirm a bare "India" for it.
  check("which city from the profile; where located right when answered", /bengaluru/i.test(a(q.city)?.answer ?? "") && (a(q.location) === undefined || /bengaluru|india/i.test(a(q.location)!.answer)), `${a(q.city)?.answer} | ${a(q.location)?.answer}`);
  check("notice period from your saved answer (30)", /\b30\b/.test(a(q.notice)?.answer ?? ""), a(q.notice)?.answer);
  check("authorized in India (the job's country) from your India answer", /^yes/i.test(a(q.authIndia)?.answer ?? ""), a(q.authIndia)?.answer);
  check("NOT: sponsorship for India from your US answer", a(q.sponsorIndia) === undefined, a(q.sponsorIndia)?.answer);
  check("NOT: a post code nobody gave (an address line is not one)", a(q.zip) === undefined, a(q.zip)?.answer);
  check("NOT: a profile fact for 'show us how you teach' (30 Oct, Supabase got the city)", a(q.teach) === undefined, a(q.teach)?.answer);
  check("NOT: a Codechef rating from the Codeforces one", a(q.codechef) === undefined, a(q.codechef)?.answer);
  check("NOT: a preference for office days nobody stated", a(q.remote) === undefined, a(q.remote)?.answer);
  check("the LinkedIn link from the profile", a(q.linkedin)?.answer === profile.linkedin, a(q.linkedin)?.answer);
}

main();
