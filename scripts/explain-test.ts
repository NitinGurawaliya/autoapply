// Offline checks for the plain-language outcomes and the field grouping. npx tsx scripts/explain-test.ts
import { groupFields, groupOf } from "../src/lib/field-groups";
import { explainOutcome } from "../src/lib/explain";
import { buildSteps } from "../src/lib/steps";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

// Every block rule the governance module can produce has its own wording and a next step.
for (const rule of ["min_match_score", "no_duplicate_role", "max_per_company_per_week", "max_applications_per_day", "test_profile_mock_only", "board_not_supported", "profile_required"]) {
  const o = explainOutcome("blocked", rule);
  check(`blocked by ${rule} is explained`, o.tone === "danger" && o.headline !== "Your agent held this one back" && !!o.next, o.headline);
}
check("an unknown rule is never named on screen", !/some_new_rule/.test(JSON.stringify(explainOutcome("blocked", "some_new_rule"))) && !!explainOutcome("blocked", "some_new_rule").next);

const failures: Array<[string, RegExp]> = [
  ["Security code was not entered in time. Open the form and apply by hand.", /security code didn.t arrive/],
  ["Greenhouse did not accept the security code after 3 tries.", /security code didn.t work/],
  ["Greenhouse showed a CAPTCHA. Open the form and submit it yourself.", /wanted a person/],
  ["Greenhouse rejected the form: Phone, Email", /didn.t accept some answers/],
  ["Submit clicked but no confirmation appeared. Check your email before applying again.", /No confirmation yet/],
  ["The worker stopped while running this application. Retry it.", /interrupted/],
  ['Your saved answer for "Location" does not match this form\'s options', /saved answer doesn.t fit/],
  ["Resume upload failed: file too large", /resume wouldn.t upload/],
  ["lever adapter is not ready", /Apply on the posting/],
  ['No option "Greater Delhi" for "Location (City)"', /didn.t match the form/],
  ["page.goto: Timeout 30000ms exceeded.", /page didn.t load/],
  ["page.goto: net::ERR_ABORTED at http://x", /page didn.t load/],
];
for (const [message, expected] of failures) {
  const o = explainOutcome("failed", message);
  check(`failure "${message.slice(0, 48)}" is explained`, expected.test(o.headline) && !!o.next && o.tone === "danger", o.headline);
}
const unknown = explainOutcome("failed", "Totally unexpected thing");
check("an unrecognised failure gets a safe default with a next step", unknown.headline === "Your agent couldn't send this one" && /Retry/.test(unknown.next ?? ""));
check("the rejected-form message carries the field names", /Phone, Email/.test(explainOutcome("failed", "Greenhouse rejected the form: Phone, Email").next ?? ""));
check("a waiting code and a waiting answer read differently", explainOutcome("needs_input", null, "code").headline !== explainOutcome("needs_input", null, "answers").headline);
check("submitted and cancelled have the right tone", explainOutcome("submitted", null).tone === "success" && explainOutcome("cancelled", "Cancelled by you").tone === "neutral");
check("a running status needs nothing from the user", explainOutcome("filling", null).next === null && explainOutcome("queued", null).next === null);

// Field grouping
check("contact fields group together", ["first_name", "email", "phone", "country"].every((k) => groupOf(k) === "Contact"));
check("sensitive answers are 'Your answers'", ["notice_period", "expected_ctc", "work_authorization", "needs_sponsorship"].every((k) => groupOf(k) === "Your answers"));
check("job-specific questions are 'Your answers'", groupOf("q_0123456789ab") === "Your answers");
check("equal-opportunity fields are separate", ["gender", "veteran_status", "disability"].every((k) => groupOf(k) === "Equal opportunity"));
check("unknown keys fall to Other", groupOf("something_else") === "Other");
const grouped = groupFields([
  { key: "gender", label: "Gender", value: "Decline", source: "default" },
  { key: "email", label: "Email", value: "x", source: "user" },
  { key: "first_name", label: "First", value: "T", source: "user" },
  { key: "resume", label: "Resume", value: "r.pdf", source: "resume" },
  { key: "q_0123456789ab", label: "Q", value: "Yes", source: "user" },
]);
check("groups come in a fixed order and skip empty ones", grouped.map((g) => g.name).join(",") === "Contact,Documents,Your answers,Equal opportunity", grouped.map((g) => g.name).join(","));
check("fields keep their fill order inside a group", grouped[0].fields.map((f) => f.key).join(",") === "email,first_name");

// Steps
const ev = (type: string, message = "", rule?: string) => ({ type, message, rule });
const states = (steps: ReturnType<typeof buildSteps>) => steps.map((s) => `${s.key}:${s.state}`).join(" ");
const full = buildSteps([ev("rule_check", "ok", "swipe_right"), ev("rule_check", "ok", "start"), ev("inspect", "Found 10 fields"), ev("resolve", "Resolved 9, pending 0"), ev("fill", "Filled a"), ev("screenshot", "k"), ev("rule_check", "ok", "submit"), ev("submit", 'Application submitted. Confirmation: text "Thank you for applying"')], "submitted");
check("a submitted application shows every step done, confirmed, with no raw page text", full.every((s) => s.state === "done") && full.at(-1)?.note === "The job board confirmed it" && !JSON.stringify(full).includes("Thank you"), states(full));
check("the story never mentions rule checks", !full.some((s) => /rule/i.test(s.label)));
check("the form step counts its questions", full.find((s) => s.key === "read")?.note === "10 questions");
const filling = buildSteps([ev("rule_check", "ok"), ev("inspect", "Found"), ev("resolve", "Resolved 9, pending 0")], "filling");
check("a running application has exactly one current step", filling.filter((s) => s.state === "current").length === 1 && filling.find((s) => s.state === "current")?.key === "filled", states(filling));
const blockedSteps = buildSteps([ev("block", "Match score 35 is below 40", "min_match_score")], "blocked");
check("a blocked application is one held-back step", blockedSteps.length === 1 && blockedSteps[0].state === "stopped" && !/rule/i.test(blockedSteps[0].label), states(blockedSteps));
const failedMid = buildSteps([ev("rule_check", "ok"), ev("inspect", "Found"), ev("error", "page.goto: Timeout")], "failed");
check("a failure stops at the step it reached", failedMid.find((s) => s.state === "stopped")?.key === "prepared", states(failedMid));
const waiting = buildSteps([ev("rule_check", "ok"), ev("inspect", "Found"), ev("resolve", "Resolved 5, pending 2"), ev("ask_user", "Need 2 answers")], "needs_input");
check("waiting for the user adds a step that is current", waiting.find((s) => s.key === "asked")?.state === "current", states(waiting));
const codeFlow = buildSteps([ev("rule_check", "ok"), ev("inspect", "x"), ev("resolve", "Resolved 9"), ev("fill", "f"), ev("ask_user", "Waiting for the emailed security code")], "needs_input");
check("a security code adds its own step after filling, and no separate wait step", codeFlow.find((s) => s.key === "code")?.state === "current" && !codeFlow.some((s) => s.key === "asked"), states(codeFlow));

console.log(failed === 0 ? "PASS explain" : `FAIL explain (${failed})`);
process.exit(failed === 0 ? 0 : 1);
