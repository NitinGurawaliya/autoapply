/** Plain names for the canonical answer keys, for screens that list what is saved. */
export const ANSWER_LABELS: Record<string, string> = {
  first_name: "First name", last_name: "Last name", full_name: "Full name", email: "Email", phone: "Phone", city: "City", country: "Country",
  linkedin: "LinkedIn", github: "GitHub", portfolio: "Portfolio or website", resume: "Resume",
  years_experience: "Years of experience", current_title: "Current job title", current_company: "Current company", employment_type: "Employment type wanted",
  start_date: "Available to start", preferred_location: "Preferred locations",
  current_ctc: "Current CTC", expected_ctc: "Expected CTC", salary_expectation: "Salary expectation", notice_period: "Notice period (days)",
  work_authorization: "Work authorization", needs_sponsorship: "Needs visa sponsorship", willing_to_relocate: "Willing to relocate",
  gender: "Gender", race: "Race", ethnicity: "Ethnicity", veteran_status: "Veteran status", disability: "Disability", pronouns: "Pronouns",
  how_heard: "How you heard about the job", cover_letter: "Cover letter", free_text: "Additional information",
};

/** Keys a user may add by hand. Identity details and the resume come from the profile, so they are not here. */
export const ADDABLE_KEYS = [
  "current_ctc", "expected_ctc", "salary_expectation", "notice_period", "work_authorization", "needs_sponsorship", "willing_to_relocate",
  "employment_type", "preferred_location", "start_date", "how_heard", "gender", "race", "ethnicity", "veteran_status", "disability", "pronouns",
  "cover_letter", "free_text",
] as const;

export const SENSITIVE_KEYS = new Set(["current_ctc", "expected_ctc", "salary_expectation", "notice_period", "work_authorization", "needs_sponsorship", "willing_to_relocate"]);
