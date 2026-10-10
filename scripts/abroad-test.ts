// Offline checks for questions about places outside the candidate's home country (modules/apply/abroad.ts, places.ts,
// derive.ts), using the questions seen on real Greenhouse forms on 10 Oct for a candidate in Bengaluru.
// npx tsx scripts/abroad-test.ts
import { resolveValues } from "../src/modules/apply";
import type { FormField } from "../src/modules/apply";
import { CITIZENSHIP_KEY, citizenshipCodes, RELOCATE_ABROAD_KEY } from "../src/modules/apply/abroad";
import { deriveAnswers } from "../src/modules/apply/derive";
import { outsideHomeCountry, placesNamed } from "../src/modules/apply/places";
import { SPONSORSHIP_ABROAD_KEY } from "../src/modules/apply/sponsorship";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const profile = { fullName: "Test User", email: "t@example.com", phone: "123", city: "Bangalore", country: "India", linkedin: null, github: null, portfolio: null, yearsExperience: 1, currentTitle: "Software Engineer", currentCompany: "Acme", resumeKey: "resumes/u/resume.pdf" };
const forDerive = { country: "India", city: "Bangalore", yearsExperience: 1, currentCompany: "Acme", skills: [], experience: [] };
const yesNo = (label: string, options = ["Yes", "No"]): FormField => ({ selector: `[name="${label.slice(0, 20)}"]`, label, type: "select", required: true, options });
const london = { company: "Deliveroo", country: "OTHER" };
const us = { company: "C3 AI", country: "US" };
const india = { company: "Razorpay", country: "IN" };
type Row = { key: string; answer: string; source: string };
const run = (field: FormField, job: { company: string; country: string }, answers: Row[], key: string | null = null) => resolveValues([{ field, key }], profile, answers, undefined, undefined, job);
const notMoving: Row = { key: RELOCATE_ABROAD_KEY, answer: "No, only jobs where I live", source: "user" };
const sponsorYes: Row = { key: SPONSORSHIP_ABROAD_KEY, answer: "Yes", source: "user" };
const indian: Row = { key: CITIZENSHIP_KEY, answer: "Indian", source: "user" };

async function main() {
  check("places named in questions", placesNamed("Please confirm you're based in BC or Ontario.").codes.has("CA") && placesNamed("our London Cannon Street office").codes.has("UK") && placesNamed("Headquarters in Redwood City, CA").codes.has("US"));
  check("'let us know' is not the United States", !placesNamed("Please let us know if you are located in Canada?").codes.has("US") && placesNamed("authorized to work in the US?").codes.has("US"));
  check("outside home: by the place named, else by the job", outsideHomeCountry("Can you work from our Bengaluru office?", "India", "OTHER") === false && outsideHomeCountry("Can you work from our London office?", "India", "IN") === true && outsideHomeCountry("Can you work from our office 3 days a week?", "India", "US") === true && outsideHomeCountry("Can you work from our office?", "India", "REMOTE") === null);
  check("citizenship answers read as countries", citizenshipCodes("Indian")?.has("IN") === true && citizenshipCodes("India, Canada")?.size === 2 && citizenshipCodes("Martian") === null);

  // Relocating or working on site abroad.
  const office = yesNo("Are you able to travel into our London Cannon Street office 3x per week?");
  const first = run(office, london, []);
  check("an office abroad asks the one-time 'open to moving' question", first.pending.length === 1 && first.pending[0].key === RELOCATE_ABROAD_KEY, first.pending[0]?.label);
  const answered = run(office, london, [notMoving]);
  check("with 'only where I live' the London office question is No", answered.values[0]?.value === "No" && answered.pending.length === 0 && /not moving out of India/.test(answered.values[0]?.basis ?? ""), JSON.stringify(answered.values[0]));
  const hq = run(yesNo("Are you willing to work from our Headquarters in Redwood City, CA, full-time, 5 days a week?"), us, [notMoving]);
  check("and so is Redwood City HQ 5 days a week", hq.values[0]?.value === "No", JSON.stringify(hq.values[0] ?? hq.pending[0]));
  const reloc = run(yesNo("Are you willing to relocate to New York?"), us, [notMoving], "willing_to_relocate");
  check("and willing to relocate to New York", reloc.values[0]?.value === "No", JSON.stringify(reloc.values[0] ?? reloc.pending[0]));
  const assistance = run(yesNo("Samsara will not provide relocation assistance for this role. Do you require relocation assistance?"), us, [notMoving]);
  check("relocation assistance is a different fact: asked", assistance.values.length === 0);
  const events = run(yesNo("We require all colleagues to meet in person 2-4 times a year at company events. Are you able to?"), us, [notMoving]);
  check("a few trips a year is not moving: asked", events.values.length === 0);
  const home = run(yesNo("Are you able to come into our Bengaluru office 3 days a week?"), india, [notMoving]);
  check("an office at home is never answered from it", home.values.length === 0);
  const open = run(office, london, [{ key: RELOCATE_ABROAD_KEY, answer: "Yes", source: "user" }]);
  check("with Yes the per-job question is asked", open.values.length === 0 && open.pending[0]?.key !== RELOCATE_ABROAD_KEY);

  // Work authorization abroad, from the sponsorship answer.
  const auth = yesNo("Are you legally authorized to work in the United States for LaunchDarkly?");
  const askFirst = run(auth, us, [], "work_authorization");
  check("authorization abroad asks the one-time sponsorship question", askFirst.pending[0]?.key === SPONSORSHIP_ABROAD_KEY);
  const usAuth = run(auth, us, [sponsorYes], "work_authorization");
  check("needing sponsorship abroad → not authorized in the US", usAuth.values[0]?.value === "No" && usAuth.values[0]?.source === "derived", JSON.stringify(usAuth.values[0]));
  const canada = run(yesNo("Do you have a legal right to work in Canada if hired by Greenhouse?"), { company: "Greenhouse", country: "OTHER" }, [sponsorYes]);
  check("and no right to work in Canada", canada.values[0]?.value === "No");
  const noSponsor = run(auth, us, [{ key: SPONSORSHIP_ABROAD_KEY, answer: "No", source: "user" }], "work_authorization");
  check("not needing sponsorship does not prove authorization: asked", noSponsor.values.length === 0);
  const homeAuth = run(yesNo("Are you legally authorized to work in India?"), india, [sponsorYes], "work_authorization");
  check("authorization at home is never answered from it", homeAuth.values.length === 0);

  const resideAuth = yesNo("Are you legally authorized to work in the country you reside?");
  check("authorized where you reside: asks citizenship once", run(resideAuth, india, [], "work_authorization").pending[0]?.key === CITIZENSHIP_KEY);
  check("a citizen living at home is authorized where they reside", run(resideAuth, india, [indian], "work_authorization").values[0]?.value === "Yes");
  check("a non-citizen of the home country is asked", run(resideAuth, india, [{ key: CITIZENSHIP_KEY, answer: "Canadian", source: "user" }], "work_authorization").values.length === 0);

  // Citizenship lists.
  const cit = yesNo("Is your most recent country of citizenship one of the following countries: Cuba, Iran, North Korea (DPRK), or Syria?");
  const citFirst = run(cit, us, []);
  check("a citizenship list asks the one-time citizenship question", citFirst.pending[0]?.key === CITIZENSHIP_KEY, citFirst.pending[0]?.label);
  const citNo = run(cit, us, [indian]);
  check("an Indian citizen → No", citNo.values[0]?.value === "No", JSON.stringify(citNo.values[0]));
  const pr = run(yesNo("Is your most recent legal permanent residency in one of the following countries: Cuba, Iran, North Korea (DPRK), or Syria?"), us, [indian]);
  check("an Indian citizen living in India → permanent residency there is No", pr.values[0]?.value === "No", JSON.stringify(pr.values[0] ?? pr.pending[0]));
  const usCitizen = run(yesNo("Are you a citizen of the United States?"), us, [{ key: CITIZENSHIP_KEY, answer: "India, United States", source: "user" }]);
  check("a dual citizen of the named country → Yes", usCitizen.values[0]?.value === "Yes");
  const usPerson = run(yesNo("A 'U.S. person' is a citizen, legal permanent resident, or legal temporary resident. Are you a U.S. person?"), us, [indian]);
  check("'U.S. person' is not settled by citizenship: asked", usPerson.values.length === 0);

  // Worked out from the location alone.
  const sanctions = "Are you located in one of the following countries or regions: Belarus, Cuba, Iran, North Korea (DPRK), Syria, or Russia, including the Ukrainian territories annexed by Russia (The Crimea region of Ukraine, The Donetsk People's Republic (DNR), The Luhansk People's Republic (LNR), Kherson or Zaporizhzhia)";
  const province = "Due to current team needs, we are only considering candidates based in BC or Ontario. Please confirm you're based in BC or Ontario.";
  const zone = "What timezone do you reside in?";
  const bengaluru = "Are you currently based in Bengaluru?";
  const found = await deriveAnswers({ profile: forDerive, fields: [sanctions, province, zone, bengaluru].map((label) => yesNo(label)) });
  check("located in a sanctioned country → No", found.get(sanctions)?.answer === "No", found.get(sanctions)?.basis);
  check("based in BC or Ontario → No", found.get(province)?.answer === "No", found.get(province)?.basis);
  check("time zone → India Standard Time", /India Standard Time/.test(found.get(zone)?.answer ?? ""), found.get(zone)?.answer);
  check("a city in the home country is not settled by the country: asked", !found.has(bengaluru));

  console.log(failed === 0 ? "PASS abroad" : `FAIL abroad (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
