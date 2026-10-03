import type { ParsedProfile } from "./profileSchema";

/** Used only when PDF text extraction or the LLM call fails. */
export const sampleProfile: ParsedProfile = {
  fullName: "Sample Candidate",
  email: "sample@example.com",
  phone: null,
  city: null,
  country: null,
  linkedin: null,
  github: null,
  portfolio: null,
  yearsExperience: null,
  currentTitle: null,
  currentCompany: null,
  skills: [],
  experience: [],
  education: [],
};
