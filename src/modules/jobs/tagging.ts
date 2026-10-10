const INDIA = [
  "india",
  "ind",
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
  "mohali",
  "lucknow",
  "coimbatore",
  "thiruvananthapuram",
  "trivandrum",
  "bhubaneswar",
  "nagpur",
  "vadodara",
  "visakhapatnam",
  "mysuru",
  "mysore",
];

// Cities often written without their state, and every state's name (Georgia is left out: it is also a country).
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
  "houston",
  "dallas",
  "miami",
  "san mateo",
  "palo alto",
  "mountain view",
  "san jose",
  "sunnyvale",
  "santa clara",
  "bay area",
  "silicon valley",
  "washington, d.c.",
  "washington dc",
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "hawaii",
  "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts",
  "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
  "new mexico", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island",
  "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia",
  "wisconsin", "wyoming",
];

// "Palo Alto, CA", "Houston, TX": a two-letter state code after a comma, in capitals as the posting writes it.
const US_STATE_CODE =
  /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;
// Places that make such a code mean something else ("Toronto, ON, CA" is in Canada).
const NOT_US = /canada|ontario|toronto|vancouver|montreal|quebec|alberta|british columbia/i;

export type JobTags = {
  country: "IN" | "US" | "REMOTE" | "OTHER";
  remoteType: "remote" | "hybrid" | "onsite" | "unknown";
  experienceMin: number | null;
};

const ENTRY_TITLE = /\b(intern(ship)?s?|trainee|apprentice|graduate|fresher|new grad|campus|vapasi)\b/i;

/** Years of experience a title implies on its own ("Senior" is about 5). Null when the title says nothing. */
export function titleYears(title: string): number | null {
  const t = title.toLowerCase();
  if (ENTRY_TITLE.test(t)) return 0;
  if (/\b(principal|distinguished|fellow|director|vp|vice president|head of)\b/.test(t)) return 10;
  if (/\bstaff\b/.test(t)) return 8;
  if (/\b(manager|architect|lead)\b/.test(t)) return 6;
  if (/\b(senior|sr\.?)\s/.test(`${t} `)) return 5;
  if (/\b(junior|jr\.?|entry[- ]level)\b/.test(t)) return 0;
  const level = t.match(/\b(?:engineer|developer|sde|swe|analyst|scientist|consultant)\s*[-–]?\s*(iv|iii|ii|i|[1-4])\b/);
  if (level) return ({ iv: 7, "4": 7, iii: 5, "3": 5, ii: 2, "2": 2, i: 0, "1": 0 } as Record<string, number>)[level[1]] ?? null;
  return null;
}

/** Years of experience a posting asks for, from its title and its "N years of experience" phrases. Null if unknown. */
export function requiredYears(title: string, description: string): number | null {
  if (ENTRY_TITLE.test(title)) return 0;
  const fromTitle = titleYears(title);
  const text = description.slice(0, 8000);
  const found: number[] = [];
  const add = (raw: string | undefined) => {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 15) found.push(n);
  };
  // "5+ years of relevant experience", "3-5 years' experience": the lower bound counts.
  for (const m of text.matchAll(/(\d{1,2})\s*(?:\+|plus)?\s*(?:[-–]|to)?\s*\d{0,2}\s*\+?\s*(?:years?|yrs?)\b[^.\n]{0,50}?experience/gi)) add(m[1]);
  // "experience of at least 4 years"
  for (const m of text.matchAll(/experience[^.\n]{0,40}?(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi)) add(m[1]);
  // "minimum 3 years", "at least 5 years"
  for (const m of text.matchAll(/(?:minimum|at least|min\.?)\s*(?:of\s*)?(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi)) add(m[1]);
  const fromText = found.length ? Math.max(...found) : null;
  if (fromTitle == null) return fromText;
  if (fromText == null) return fromTitle;
  return Math.max(fromTitle, fromText);
}

/** Whole words only: "india" must not match "Indiana". */
function includesAny(text: string, words: string[]) {
  return words.some((word) => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z])`).test(text));
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
  else if (includesAny(place, US) || /\b(us|u\.s\.)\b/.test(place) || (US_STATE_CODE.test(input.location) && !NOT_US.test(input.location))) country = "US";
  else if (remoteHint) country = "REMOTE";

  let remoteType: JobTags["remoteType"] = "unknown";
  if (/hybrid/.test(place)) remoteType = "hybrid";
  else if (remoteHint) remoteType = "remote";
  else if (/on-?site|in-?office/.test(place)) remoteType = "onsite";

  const experienceMin = requiredYears(input.title, input.description);

  return { country, remoteType, experienceMin };
}
