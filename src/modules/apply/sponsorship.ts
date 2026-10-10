/**
 * Visa sponsorship is asked per country (the answer for Toronto says nothing about India), so a candidate applying
 * abroad was asked it again for every new country. Most candidates have one answer for everywhere outside their home
 * country, so the agent asks that once: "Do you need visa sponsorship to work in any country other than India?".
 * Yes or No is then the user's own answer for every job outside the home country; "It depends on the country" keeps
 * the per-country question. Never applied to a job in the home country, or to a remote job (no country to compare).
 */
export const SPONSORSHIP_ABROAD_KEY = "sponsorship_outside_home";

export const SPONSORSHIP_ABROAD_OPTIONS = ["Yes", "No", "It depends on the country"];

export function sponsorshipAbroadQuestion(home: string) {
  return `Do you need visa sponsorship to work in any country other than ${home}?`;
}

/** The job-country code (as tagging.ts writes Job.country) of the profile's country, when we can tell. */
export function homeCountryCode(country: string | null | undefined): "IN" | "US" | null {
  const text = (country ?? "").trim().toLowerCase();
  if (/\bindia\b/.test(text)) return "IN";
  if (/^(us|usa|u\.s\.a?\.?)$|united states/.test(text)) return "US";
  return null;
}

/** Whether a job is in a country other than the candidate's own (IN, US and OTHER are countries; REMOTE is not). */
export function outsideHome(profileCountry: string | null | undefined, jobCountry: string | null | undefined) {
  const home = homeCountryCode(profileCountry);
  if (!home || !jobCountry || jobCountry === "REMOTE") return false;
  return jobCountry !== home;
}

/** The standing answer as Yes or No, or null when it is "it depends" (ask per country) or anything else. */
export function standingSponsorship(answer: string | undefined) {
  const text = (answer ?? "").trim();
  if (/^yes\b/i.test(text)) return "Yes";
  if (/^no\b/i.test(text)) return "No";
  return null;
}
