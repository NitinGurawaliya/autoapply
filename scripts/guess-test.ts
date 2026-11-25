// Guess and send (4 Nov), offline: what may be guessed, that a guess fits its field, and that the resolver uses a guess
// only where it would otherwise ask (every earlier source wins). No model call.
// npx tsx scripts/guess-test.ts
import { customQuestionKey, matchKeyBySynonym } from "../src/modules/answers";
import type { FormField } from "../src/modules/apply/adapter";
import { fitGuess, guessable, ownLink } from "../src/modules/apply/guess";
import type { MemoryAnswer } from "../src/modules/apply/recall";
import { resolveValues } from "../src/modules/apply/valueResolver";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` (${detail})` : ""}`);
}

const field = (label: string, type = "text", options?: string[]): FormField => ({ selector: `[name="${label.slice(0, 12)}"]`, label, type, required: true, ...(options ? { options } : {}) });

// Never guessed.
for (const label of ["Date of Birth", "Specially abled", "Differently-abled?", "Are you a PwD candidate?", "Physically challenged", "Medical Background", "E-sign below", "Aadhaar number", "PAN Card", "Passport number", "Have you ever been convicted of a criminal offence?", "Signature", "Gender", "Are you a protected veteran?", "Disability status"]) {
  check(`never guessed: "${label}"`, !guessable(field(label)));
}
for (const label of ["How many years of experience do you have with Kafka?", "Discipline", "Preferred Location (smartcoin)", "Will you relocate to Chennai?", "How did you hear about us?", "Reason for change", "Have you independently owned features from design through deployment?", "If Resigned/ Serving Notice - What is LWD ?", "Have you worked at a broadcaster?"]) {
  check(`may be guessed: "${label}"`, guessable(field(label)));
}
check("Indian disability wordings are the disability question (Decline to answer, never guessed)", ["Specially abled", "Differently-abled?", "Are you a PwD candidate?", "Physically challenged"].every((label) => matchKeyBySynonym(label) === "disability"));
check("a file is never guessed", !guessable(field("Cover letter upload", "file")));
// 23 Nov (Workday dry runs): identity-like numbers, SMS consent and marketing choices are the user's alone.
for (const label of ["Enter the Roll number/ Seat Number / Registration Number of your highest qualification", "Student ID", "By providing your telephone number in this application, you consent to receive text messages"]) {
  check(`never guessed: "${label.slice(0, 50)}"`, !guessable(field(label)));
}
check("a choice to subscribe to marketing is never guessed", !guessable({ label: "Fractal Analytics is committed to protecting your privacy", type: "select", options: ["I wish to subscribe for the marketing communications", "I do not wish to subscribe"] }));
// 18 Nov, iion on Keka: pay is never guessed, in any currency or wording; it is asked.
for (const label of ["Current Gross base Salary - Annual (USD)", "Expected Gross base Salary - Annual (USD)", "Salary expectation in EUR per year", "What is your current CTC (in LPA)?"]) {
  check(`pay is never guessed: "${label}"`, !guessable(field(label, "number")));
}
// 18 Nov, secfix: a link to a video the candidate records is asked, never guessed; a choice about video is still guessed.
const video = "Video (1–1.5 minutes, link via Loom, YouTube or similar): What is one technical skill you learned in the past 6 months?";
check("a video link to record is never guessed", !guessable(field(video, "text")) && !guessable(field("Loom recording URL", "text")));
check("a yes/no about video is still guessed", guessable(field("Have you edited YouTube videos?", "radio", ["Yes", "No"])));
const resumeText = "Projects: https://github.com/someone/tool and portfolio www.someone.dev/work";
check("a guessed link the resume has is kept", ownLink(field("GitHub link"), "https://github.com/someone/tool", resumeText) === "https://github.com/someone/tool");
check("a guessed link the candidate never gave is refused", ownLink(field("Portfolio URL"), "https://someone-portfolio.com/", resumeText) === null && ownLink(field("Portfolio URL"), "I do not have one yet", resumeText) === null);
check("a question that is not about a link passes unchanged", ownLink(field("Why this role?"), "Because of the product", resumeText) === "Because of the product" && ownLink(field("LinkedIn profile"), "x", "") === "x");

// A guess fits its field.
const offices = ["Bengaluru - HSR", "Mumbai - BKC", "Pune"];
check("an option is taken by its exact text", fitGuess(field("Office", "select", offices), "Bengaluru - HSR") === "Bengaluru - HSR");
check("an option is matched ignoring case and spacing", fitGuess(field("Office", "select", offices), "  pune ") === "Pune");
check("an answer that is no option is refused", fitGuess(field("Office", "select", offices), "Delhi") === null);
check("a multi-select keeps the options it names, one per line", fitGuess(field("Tools", "checkbox-group", ["AWS", "GCP", "Azure"]), "AWS, GCP") === "AWS\nGCP");
check("a number box takes the number", fitGuess(field("Years with Go", "number"), "about 2 years") === "2");
check("a number box refuses words", fitGuess(field("Years with Go", "number"), "some") === null);
check("'null' or 'unknown' is no answer for a text box", fitGuess(field("Reason for change"), "null") === null && fitGuess(field("Reason for change"), "unknown") === null);
const longOptions = ["Less than 2 years", "2 to 5 years of building and maintaining production software", "More than 5 years"];
check("an option by its number", fitGuess(field("Years building production software", "radio", longOptions), "2") === longOptions[1]);
check("an option copied with its number", fitGuess(field("Owned features?", "radio", ["Yes", "No"]), "2. No") === "No");
check("a numbered answer when the options are numbers themselves", fitGuess(field("Years building software", "radio", ["3-5", "5-7", "8+"]), "1. 3-5") === "3-5");
check("an option by most of its words", fitGuess(field("Years building production software", "radio", longOptions), "2 to 5 years building production software") === longOptions[1]);
check("a far-off answer is no option", fitGuess(field("Years building production software", "radio", longOptions), "I am not sure") === null);
check("'None' and 'Not applicable' are answers to a text question", fitGuess(field("Relatives at Druva?"), "None") === "None" && fitGuess(field("Last working day if serving notice?"), "Not applicable") === "Not applicable");
const nov = new Date("2026-11-04T00:00:00Z");
check("a last working day in the past is refused", fitGuess(field("If Resigned/ Serving Notice - What is LWD ?"), "2024-08-03", nov) === null);
check("a last working day ahead is kept", fitGuess(field("If Resigned/ Serving Notice - What is LWD ?"), "2026-12-04", nov) === "2026-12-04");
check("a past date for another question (graduation) is kept", fitGuess(field("Graduation date"), "2024-06-30", nov) === "2024-06-30");
check("plain text is kept", fitGuess(field("Reason for change"), "Looking for larger backend systems.") === "Looking for larger backend systems.");

// The resolver: a guess only where it would ask.
const profile = { fullName: "A B", email: "a@example.test", phone: "9000012345", city: "Bengaluru", country: "India", linkedin: null, github: null, portfolio: null, yearsExperience: 2, currentTitle: "Software Engineer", currentCompany: "Acme", resumeKey: "r" };
const guess = (label: string, answer: string): [string, MemoryAnswer] => [label, { key: "", answer, basis: "best guess: test", score: 1, source: "guessed" }];
const kafka = field("How many years of experience do you have with Kafka?", "number");
const open = resolveValues([{ field: kafka, key: null }], profile, []);
check("without a guess the question is asked", open.pending.length === 1 && open.values.length === 0);
const guessed = resolveValues([{ field: kafka, key: null }], profile, [], undefined, undefined, undefined, new Map([guess(kafka.label, "2")]));
check("with a guess it is filled as a best guess, nothing asked", guessed.pending.length === 0 && guessed.values[0]?.value === "2" && guessed.values[0]?.source === "guessed" && guessed.values[0]?.basis === "best guess: test", JSON.stringify(guessed.values));
const own = resolveValues([{ field: kafka, key: null }], profile, [{ key: customQuestionKey(kafka.label), answer: "1", source: "user" }], undefined, undefined, undefined, new Map([guess(kafka.label, "2")]));
check("the user's own answer beats the guess", own.values[0]?.value === "1" && own.values[0]?.source === "user", JSON.stringify(own.values));
const city = field("City");
const fromProfile = resolveValues([{ field: city, key: "city" }], profile, [], undefined, undefined, undefined, new Map([guess("City", "Mumbai")]));
check("the profile beats the guess", fromProfile.values[0]?.value === "Bengaluru" && fromProfile.values[0]?.source === "resume", JSON.stringify(fromProfile.values));
const office = field("Preferred Location (smartcoin)", "select", offices);
const badGuess = resolveValues([{ field: office, key: null }], profile, [], undefined, undefined, undefined, new Map([guess(office.label, "Delhi")]));
check("a guess that fits no option is not filled: asked", badGuess.pending.length === 1 && badGuess.values.length === 0);
{
  // 18 Nov, iion on Keka: a guessed multi-select reaches the form, not the question list.
  const tools = field("Which of the following have you worked hands-on with?", "checkbox-group", ["Python", "SQL", "Git", "MCP"]);
  const picked = resolveValues([{ field: tools, key: null }], profile, [], undefined, undefined, undefined, new Map([guess(tools.label, fitGuess(tools, "Python, SQL, Git") ?? "")]));
  check("a guessed multi-select is filled, every pick", picked.pending.length === 0 && picked.values[0]?.value === "Python\nSQL\nGit", JSON.stringify(picked.values.map((v) => v.value)));
}
const optional = { ...field("Anything else?"), required: false };
const notRequired = resolveValues([{ field: optional, key: null }], profile, [], undefined, undefined, undefined, new Map([guess(optional.label, "No")]));
check("an optional question is left empty, not guessed", notRequired.values.length === 0 && notRequired.pending.length === 0);

console.log(failed === 0 ? "PASS guess" : `FAIL guess (${failed})`);
process.exit(failed === 0 ? 0 : 1);
