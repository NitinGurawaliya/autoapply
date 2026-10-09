// T55: essay drafts. Offline: which questions are essays, the grounding check, and the resolver rules (one permission
// question, "why us" never reused across companies, the saved best project reused, drafts used and capped). Live: two
// drafts for a sample resume and job pass the grounding check. npx tsx scripts/essay-test.ts
import type { FormField } from "../src/modules/apply";
import { draftEssays, draftIsGrounded, essayKind } from "../src/modules/apply/essay";
import type { MemoryAnswer } from "../src/modules/apply/recall";
import { resolveValues } from "../src/modules/apply/valueResolver";
import { customQuestionKey } from "../src/modules/answers";
import { loadRules } from "../src/modules/governance";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const PROFILE = { fullName: "Test Person", email: "t@example.com", phone: null, city: null, country: null, linkedin: null, github: null, portfolio: null, yearsExperience: 2, currentTitle: "Engineer", currentCompany: null, resumeKey: "resumes/x/resume.pdf" };
const area = (label: string, required = true): FormField => ({ selector: `#${customQuestionKey(label)}`, label, type: "textarea", required });
const map = (fields: FormField[]) => fields.map((field) => ({ field, key: null }));

async function main() {
  check("why-us questions are motivation essays", essayKind("Why do you want to work at Stripe?", "textarea") === "motivation" && essayKind("Why this role?", "textarea") === "motivation" && essayKind("What excites you about joining us?", "textarea") === "motivation");
  check("best-project questions are recognised", essayKind("Tell us about the best project you've built", "textarea") === "best_project" && essayKind("Describe a system you are proud of", "textarea") === "best_project");
  check("factual and sensitive questions are never essays", essayKind("What are your salary expectations?", "textarea") === null && essayKind("Why do you require visa sponsorship?", "textarea") === null && essayKind("Why this role?", "select") === null);

  check("a draft naming only resume and job facts is grounded", draftIsGrounded("At Acme Labs I built React dashboards; Stripe's payments work fits that.", ["Acme Labs", "React", "Stripe"], ["Engineer at Acme Labs. React, Node.", "Stripe", "Payments engineer"]));
  check("a draft naming a school not in the resume is rejected", !draftIsGrounded("I studied at Stanford University and built React apps.", ["React"], ["Engineer at Acme Labs. React."]));
  check("a draft with a number not in the resume or job is rejected", !draftIsGrounded("At Acme Labs I cut load time by 70%.", ["Acme Labs"], ["Engineer at Acme Labs. Cut page load from 6s to 2s."]));
  check("numbers the resume states are allowed", draftIsGrounded("At Acme Labs I cut page load from 6s to 2s for 40 store managers.", ["Acme Labs"], ["Engineer at Acme Labs. Cut page load from 6s to 2s for 40 store managers."]));
  check("a listed mention absent from both sources is rejected", !draftIsGrounded("I led the Kubernetes migration.", ["Kubernetes"], ["Engineer at Acme Labs. React."]));

  const why = area("Why do you want to work here?");
  const best = area("Tell us about the best project you've built");
  const permission = resolveValues(map([why, best]), PROFILE, []);
  check("without permission, one permission question is asked for all essays", permission.pending.length === 1 && permission.pending[0].key === "accept_ai_essays" && permission.values.length === 0, JSON.stringify(permission.pending.map((q) => q.key)));
  const yes = [{ key: "accept_ai_essays", answer: "Yes", source: "user" }];
  const asked = resolveValues(map([why, best]), PROFILE, yes);
  check("with permission and no draft yet, both are pending for the runner to draft", asked.pending.length === 2 && asked.pending.every((q) => q.key.startsWith("q_")));
  const other = [...yes, { key: customQuestionKey(why.label), answer: "I love Stripe.", source: "user", context: { company: "Stripe" } }, { key: "free_text", answer: "Generic", source: "user" }];
  const crossCompany = resolveValues(map([why]), PROFILE, other, undefined, undefined, { company: "Okta" });
  check("'why us' answered for Stripe is NOT reused for Okta (nor the global free-text answer)", crossCompany.values.length === 0 && crossCompany.pending.length === 1);
  const sameCompany = resolveValues(map([why]), PROFILE, other, undefined, undefined, { company: "stripe" });
  check("'why us' answered for the same company is reused", sameCompany.values[0]?.value === "I love Stripe.");
  const savedBest = resolveValues(map([area("Describe a system you are proud of")]), PROFILE, [...yes, { key: "essay_best_project", answer: "I built X.", source: "ai_draft" }]);
  check("the saved best-project answer is reused for any best-project wording", savedBest.values[0]?.value === "I built X." && savedBest.values[0]?.source === "ai_draft");

  const four = ["Why do you want to work here?", "Why this role?", "What excites you about joining us?", "Tell us about the best project you've built"].map((label) => area(label));
  const max = loadRules().max_ai_drafts_per_application;
  const drafts = new Map<string, MemoryAnswer>(four.slice(0, max).map((field) => [field.label, { key: "", answer: `Draft for ${field.label}`, basis: "AI draft", score: 1, source: "ai_draft" }]));
  const capped = resolveValues(map(four), PROFILE, yes, drafts, undefined, { company: "Okta" });
  check(`with ${max} drafts allowed, ${max} essays are drafted and the next one is asked`, capped.values.filter((v) => v.source === "ai_draft").length === max && capped.pending.length === four.length - max, `${capped.values.length} filled, ${capped.pending.length} asked`);

  const live = await draftEssays({
    profile: { fullName: "Asha Rao", currentTitle: "Full Stack Developer", skills: ["React", "Node.js", "MongoDB"], experience: [{ title: "Full Stack Developer", company: "Psquare Company", start: "Jan 2025", end: "present", summary: "Built a React and Node.js order-tracking dashboard used by 40 store managers; cut page load from 6s to 2s." }], education: [{ school: "Punjab University", degree: "B.Tech", year: "2024" }] },
    resumeText: "Asha Rao. Full Stack Developer at Psquare Company (Jan 2025 - present). Built a React and Node.js order-tracking dashboard used by 40 store managers; cut page load from 6s to 2s. Skills: React, Node.js, MongoDB. B.Tech, Punjab University, 2024.",
    job: { company: "Razorpay", title: "Software Engineer", description: "Razorpay builds payments infrastructure for Indian businesses. You will build merchant dashboards in React." },
    items: [
      { label: "Why do you want to work at Razorpay?", kind: "motivation" },
      { label: "Tell us about the best project you've built", kind: "best_project" },
    ],
  });
  check("both live drafts pass the grounding check", live.size === 2, [...live.values()].map((t) => t.slice(0, 60)).join(" | "));
  check("the why-us draft names the company", /Razorpay/.test(live.get(0) ?? ""));
  check("the best-project draft uses the resume's real project", /dashboard/i.test(live.get(1) ?? ""));
  console.log(failed ? `FAIL essay (${failed})` : "PASS essay");
  process.exit(failed ? 1 : 0);
}

main();
