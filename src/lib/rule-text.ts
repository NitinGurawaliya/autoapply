import type { Rules } from "@/modules/governance";

export type RuleLine = { id: string; title: string; value: string; meaning: string };

/** The rules the agent obeys, in plain words, with the live values from config/rules.json. Every one is enforced in code. */
export function describeRules(rules: Rules): RuleLine[] {
  const yes = (on: boolean) => (on ? "On" : "Off");
  return [
    { id: "require_user_approval", title: "Only your swipe starts an application", value: yes(rules.require_user_approval), meaning: "Nothing is sent unless you swiped right on that exact job." },
    { id: "no_fabrication", title: "Nothing is made up", value: yes(rules.no_fabrication), meaning: "Every answer comes from your resume, from you, from a stated default, or from a labelled AI draft in a free-text box." },
    { id: "sensitive_keys_never_ai", title: "Sensitive answers are never written by AI", value: `${rules.sensitive_keys_never_ai.length} kinds`, meaning: "Pay, notice period, work authorization, sponsorship and relocation are only ever filled from what you typed. If missing, it asks you." },
    { id: "eeo_default", title: "Equal-opportunity questions", value: rules.eeo_default, meaning: "Gender, race, veteran and disability questions are never guessed. They default to declining to answer." },
    { id: "min_match_score", title: "Minimum match", value: `${rules.min_match_score}%`, meaning: "Jobs that match you less than this are never applied to." },
    { id: "max_applications_per_day", title: "Daily limit", value: `${rules.max_applications_per_day} a day`, meaning: "At most this many applications start each day (UTC)." },
    { id: "max_per_company_per_week", title: "Per company", value: `${rules.max_per_company_per_week} a week`, meaning: "At most this many applications to one company in 7 days." },
    { id: "no_duplicate_role", title: "No second application to a role", value: yes(rules.no_duplicate_role), meaning: "A role you already applied to is blocked, even if it is listed twice." },
    { id: "max_in_flight_per_user", title: "Running at once", value: `${rules.max_in_flight_per_user} at most`, meaning: "Keeps one person from filling the shared queue." },
    { id: "max_ai_drafts_per_application", title: "AI drafts per application", value: `${rules.max_ai_drafts_per_application} at most`, meaning: "Only cover letter and free-text boxes can be AI drafts, and each one is labelled." },
    { id: "max_attempts", title: "Automatic retries", value: `${rules.max_attempts} tries`, meaning: "A failed run is retried once. After a submit may have gone out it is never retried, so you cannot apply twice by accident." },
    { id: "test_profile_mock_only", title: "Test profiles stay on the mock form", value: yes(rules.test_profile_mock_only), meaning: "A test profile can never reach a real company." },
    { id: "allow_submit_on_real_sites", title: "Submitting on real sites", value: yes(rules.allow_submit_on_real_sites), meaning: "The master switch for real submissions." },
  ];
}
