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

export type Eligibility = "india" | "remote_india" | "abroad" | "unknown";

export type JobTags = {
  country: "IN" | "US" | "REMOTE" | "OTHER";
  remoteType: "remote" | "hybrid" | "onsite" | "unknown";
  experienceMin: number | null;
  /** Whether a candidate in India can take the job (the feed shows india and remote_india only). */
  eligibility: Eligibility;
};

// Countries and regions other than India, for remote roles restricted to them ("Remote - US", "Remote, EMEA") and
// for places a job is located in. Whole words, lower case.
const ABROAD = [
  "canada", "mexico", "brazil", "argentina", "colombia", "chile", "peru", "costa rica", "uruguay",
  "uk", "united kingdom", "england", "scotland", "london", "manchester", "ireland", "dublin", "cork",
  "germany", "berlin", "munich", "hamburg", "france", "paris", "spain", "madrid", "barcelona", "portugal", "lisbon",
  "netherlands", "amsterdam", "belgium", "luxembourg", "switzerland", "zurich", "zürich", "geneva", "austria", "vienna",
  "italy", "milan", "poland", "warsaw", "krakow", "romania", "bucharest", "czech", "czech republic", "prague",
  "sweden", "stockholm", "denmark", "copenhagen", "norway", "oslo", "finland", "helsinki", "estonia", "latvia",
  "lithuania", "hungary", "budapest", "bulgaria", "sofia", "serbia", "belgrade", "croatia", "greece", "athens",
  "turkey", "istanbul", "ukraine", "israel", "tel aviv", "uae", "united arab emirates", "emirates", "dubai", "abu dhabi", "saudi arabia", "riyadh",
  "egypt", "cairo", "nigeria", "lagos", "kenya", "nairobi", "south africa", "cape town", "johannesburg",
  "australia", "sydney", "melbourne", "new zealand", "auckland", "japan", "tokyo", "korea", "south korea", "seoul",
  "china", "beijing", "shanghai", "shenzhen", "hong kong", "taiwan", "taipei", "singapore", "malaysia", "kuala lumpur",
  "indonesia", "jakarta", "philippines", "manila", "thailand", "bangkok", "vietnam", "pakistan", "bangladesh",
  "sri lanka", "emea", "europe", "eu", "americas", "latam", "north america", "nordics", "dach", "benelux", "anz",
  "toronto", "vancouver", "montreal", "ottawa", "calgary", "ontario", "quebec", "alberta", "british columbia",
  "amer", "nyc", "cri", "european union", "eea", "sao paulo", "são paulo", "brasil", "bogota", "buenos aires", "santiago", "lima", "montevideo",
  "edinburgh", "glasgow", "belfast", "northern ireland", "wales", "bristol", "cambridge", "oxford", "haifa",
  "osaka", "kyoto", "busan", "taichung", "chengdu", "guangzhou", "hangzhou", "macau", "cebu", "penang",
  "ho chi minh", "hanoi", "karachi", "lahore", "dhaka", "colombo", "perth", "brisbane", "adelaide", "canberra",
  "wellington", "doha", "qatar", "bahrain", "oman", "kuwait", "accra", "ghana", "casablanca", "morocco",
];

// A remote role open to someone in India: Asia-Pacific, Indian time, or no place limit at all.
const OPEN_TO_INDIA = /\b(apac|apj|asia|asia[- ]pacific|anywhere|worldwide|global(ly)?|any location|all locations|work from anywhere)\b/i;
// What a posting must say before a bare "Remote" counts as open to India. Not "global": companies use it for anything.
const DESCRIPTION_OPEN = /\bindia\b|\bIST\b|indian standard time|anywhere in the world|work from anywhere/i;
// Location words that say nothing about where ("Hybrid", "N/A"): the offices or the description must decide.
const PLACE_WORDS = /\b(remote|hybrid|work from home|wfh|on-?site|in-?office|n\/a|location|locations|distributed|multiple|flexible|tbd|only|first|based|full[- ]?time)\b/g;
// "Remote - CA", "CA-British Columbia-Remote", "US-VA-Remote": a two-letter US (or Canadian) code standing alone.
// Read only on places that are not India, where "IN" never means Indiana anyway.
const US_CODE_ALONE = /(?:^|[\s,(/-])(AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|BC|ON|QC|AB)(?=$|[\s,)/-])/;

const abroadIn = (text: string, original: string) =>
  includesAny(text, ABROAD) || includesAny(text, US) || /\b(us|u\.s\.|usa)\b/.test(text) || US_CODE_ALONE.test(original);

/**
 * Can a candidate in India take this job? The location line decides first; the board's offices only when the line
 * says nothing about where ("Remote", "Hybrid"); the description only for a bare "Remote". Located in India → india;
 * remote and in India, Asia-Pacific or anywhere → remote_india; another named place, or remote limited to other
 * countries → abroad; a place we cannot read, or nothing to go on → unknown (not shown: when unsure, leave it out).
 */
export function eligibility(input: { location: string; offices?: string[]; description: string; remote: boolean }): Eligibility {
  const location = input.location.toLowerCase();
  const offices = (input.offices ?? []).join(" ; ");
  const remoteIn = (text: string) => /\b(remote|work from home|wfh)\b/.test(text);
  // 1. India named in the location. "Bangalore, India; Remote, Poland": the India part decides whether it is remote.
  const indiaParts = location.split(/;|\||\bor\b|\/|\n/).filter((part) => includesAny(part, INDIA));
  if (indiaParts.length > 0) return indiaParts.some(remoteIn) ? "remote_india" : "india";
  // 2. The location opens it to India ("Remote, APAC", "Remote (Anywhere)", "Remote, Global").
  if (OPEN_TO_INDIA.test(location)) return "remote_india";
  // 3. The location names other countries or cities.
  if (abroadIn(location, input.location)) return "abroad";
  const named = location.replace(PLACE_WORDS, " ").replace(/[^a-z0-9]+/g, " ").trim();
  // 4. A place we cannot read ("CRI", a city not in our lists): an office job there is abroad; a remote one, unknown.
  if (named) return input.remote ? "unknown" : "abroad";
  // 5. The location says nothing about where: the offices decide.
  if (offices) {
    const lower = offices.toLowerCase();
    if (includesAny(lower, INDIA)) return input.remote ? "remote_india" : "india";
    if (input.remote && OPEN_TO_INDIA.test(lower)) return "remote_india";
    if (abroadIn(lower, offices)) return "abroad";
  }
  // 6. A bare "Remote": shown only when the posting itself opens it to India.
  if (input.remote && DESCRIPTION_OPEN.test(input.description)) return "remote_india";
  return "unknown";
}

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
  offices?: string[];
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
  const tagged = eligibility({ location: input.location, offices: input.offices, description: input.description, remote: remoteType === "remote" });

  return { country, remoteType, experienceMin, eligibility: tagged };
}
