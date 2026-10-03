const INDIA = [
  "india",
  "bengaluru",
  "bangalore",
  "hyderabad",
  "mumbai",
  "pune",
  "delhi",
  "noida",
  "gurgaon",
  "gurugram",
  "chennai",
  "kolkata",
  "ahmedabad",
  "jaipur",
  "kochi",
  "indore",
  "chandigarh",
];

const US = [
  "united states",
  "u.s.",
  "usa",
  "san francisco",
  "new york",
  "seattle",
  "austin",
  "boston",
  "chicago",
  "los angeles",
  "denver",
  "atlanta",
  "california",
];

export type JobTags = {
  country: "IN" | "US" | "REMOTE" | "OTHER";
  remoteType: "remote" | "hybrid" | "onsite" | "unknown";
  experienceMin: number | null;
};

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

export function tagPosting(input: {
  title: string;
  location: string;
  description: string;
  isRemote?: boolean;
}): JobTags {
  const place = `${input.location}`.toLowerCase();
  const remoteHint = Boolean(input.isRemote) || /remote|work from home|\bwfh\b|anywhere|worldwide/.test(place);
  let country: JobTags["country"] = "OTHER";
  if (includesAny(place, INDIA)) country = "IN";
  else if (includesAny(place, US) || /\b(us|u\.s\.)\b/.test(place)) country = "US";
  else if (remoteHint) country = "REMOTE";

  let remoteType: JobTags["remoteType"] = "unknown";
  if (/hybrid/.test(place)) remoteType = "hybrid";
  else if (remoteHint) remoteType = "remote";
  else if (/on-?site|in-?office/.test(place)) remoteType = "onsite";

  const experienceText = `${input.title}\n${input.description}`.slice(0, 4000);
  const range = experienceText.match(/(\d{1,2})\s*[-–]\s*\d{1,2}\s*(?:years|yrs)\b/i);
  const plus = experienceText.match(/(\d{1,2})\s*\+?\s*(?:years|yrs)\b/i);
  const rawYears = Number(range?.[1] ?? plus?.[1]);
  const experienceMin = Number.isFinite(rawYears) && rawYears > 0 && rawYears <= 25 ? rawYears : null;

  return { country, remoteType, experienceMin };
}
