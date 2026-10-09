export type FilledField = { key: string; label: string; value: string; source: string };

export const GROUP_ORDER = ["Contact", "Links", "Documents", "Experience", "Your answers", "Equal opportunity", "Other"] as const;
export type GroupName = (typeof GROUP_ORDER)[number];

const GROUP_OF: Record<string, GroupName> = {
  first_name: "Contact", last_name: "Contact", full_name: "Contact", email: "Contact", phone: "Contact", city: "Contact", country: "Contact",
  linkedin: "Links", github: "Links", portfolio: "Links",
  resume: "Documents", cover_letter: "Documents",
  years_experience: "Experience", current_title: "Experience", current_company: "Experience", start_date: "Experience", employment_type: "Experience", preferred_location: "Experience",
  current_ctc: "Your answers", expected_ctc: "Your answers", salary_expectation: "Your answers", notice_period: "Your answers",
  work_authorization: "Your answers", needs_sponsorship: "Your answers", willing_to_relocate: "Your answers",
  gender: "Equal opportunity", race: "Equal opportunity", ethnicity: "Equal opportunity", veteran_status: "Equal opportunity", disability: "Equal opportunity", pronouns: "Equal opportunity",
};

export function groupOf(key: string): GroupName {
  if (GROUP_OF[key]) return GROUP_OF[key];
  // Job-specific questions are saved under q_<hash>; they are things the user answered for this kind of form.
  return /^q_[a-f0-9]{12}$/.test(key) ? "Your answers" : "Other";
}

/** Filled fields grouped for reading, in a fixed order, keeping the order they were filled within each group. */
export function groupFields(fields: FilledField[]) {
  const buckets = new Map<GroupName, FilledField[]>();
  for (const field of fields) {
    const name = groupOf(field.key);
    buckets.set(name, [...(buckets.get(name) ?? []), field]);
  }
  return GROUP_ORDER.filter((name) => buckets.has(name)).map((name) => ({ name, fields: buckets.get(name) ?? [] }));
}
