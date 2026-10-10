/**
 * Which countries a form question names ("Are you based in BC or Ontario?", "located in Belarus, Cuba, Iran...",
 * "our London office"), as country codes. Shared by the answers worked out from the profile (derive.ts) and the ones
 * read from the user's standing answers for jobs abroad (abroad.ts).
 */

export const COUNTRIES: Record<string, string[]> = {
  US: ["united states", "united states of america", "usa", "u s a", "us", "u s", "america"],
  CA: ["canada"],
  UK: ["united kingdom", "uk", "u k", "great britain", "britain", "england", "scotland", "wales", "northern ireland"],
  IN: ["india", "bharat"],
  IE: ["ireland"],
  DE: ["germany"],
  FR: ["france"],
  NL: ["netherlands", "the netherlands", "holland"],
  ES: ["spain"],
  PT: ["portugal"],
  IT: ["italy"],
  PL: ["poland"],
  SE: ["sweden"],
  CH: ["switzerland"],
  BE: ["belgium"],
  AT: ["austria"],
  DK: ["denmark"],
  NO: ["norway"],
  FI: ["finland"],
  CZ: ["czech republic", "czechia"],
  RO: ["romania"],
  SG: ["singapore"],
  AU: ["australia"],
  NZ: ["new zealand"],
  JP: ["japan"],
  CN: ["china"],
  KR: ["south korea", "republic of korea"],
  KP: ["north korea", "dprk", "democratic people s republic of korea"],
  IL: ["israel"],
  AE: ["united arab emirates", "uae"],
  SA: ["saudi arabia"],
  BR: ["brazil"],
  MX: ["mexico"],
  AR: ["argentina"],
  CO: ["colombia"],
  CR: ["costa rica"],
  PH: ["philippines"],
  MY: ["malaysia"],
  ID: ["indonesia"],
  VN: ["vietnam"],
  ZA: ["south africa"],
  NG: ["nigeria"],
  EG: ["egypt"],
  PK: ["pakistan"],
  BD: ["bangladesh"],
  LK: ["sri lanka"],
  RU: ["russia", "russian federation"],
  BY: ["belarus"],
  UA: ["ukraine"],
  CU: ["cuba"],
  IR: ["iran"],
  SY: ["syria"],
  VE: ["venezuela"],
};

// Places inside a country. A question about one can be settled from the candidate's country only when the country
// differs (someone in India is not based in Ontario; someone elsewhere in Canada might or might not be).
export const SUB_REGIONS: Record<string, string> = {
  // Canada
  bc: "CA", "british columbia": "CA", ontario: "CA", quebec: "CA", alberta: "CA", manitoba: "CA", "nova scotia": "CA", toronto: "CA", vancouver: "CA", montreal: "CA", ottawa: "CA", calgary: "CA", waterloo: "CA",
  // United States
  california: "US", texas: "US", "new york": "US", nyc: "US", washington: "US", massachusetts: "US", illinois: "US", colorado: "US", florida: "US", georgia: "US", virginia: "US", "north carolina": "US", oregon: "US", utah: "US", arizona: "US", pennsylvania: "US", "new jersey": "US", michigan: "US", ohio: "US", minnesota: "US",
  "san francisco": "US", "bay area": "US", "san francisco bay area": "US", "silicon valley": "US", seattle: "US", boston: "US", chicago: "US", austin: "US", denver: "US", "los angeles": "US", "san jose": "US", "san mateo": "US", "palo alto": "US", "mountain view": "US", "redwood city": "US", "menlo park": "US", "sunnyvale": "US", "santa clara": "US", atlanta: "US", miami: "US", "salt lake city": "US", portland: "US", "washington dc": "US", "washington d c": "US",
  // United Kingdom and Ireland
  "northern ireland": "UK", scotland: "UK", wales: "UK", england: "UK", london: "UK", manchester: "UK", edinburgh: "UK", cambridge: "UK", dublin: "IE",
  // Europe
  berlin: "DE", munich: "DE", hamburg: "DE", paris: "FR", amsterdam: "NL", madrid: "ES", barcelona: "ES", lisbon: "PT", warsaw: "PL", krakow: "PL", stockholm: "SE", zurich: "CH", copenhagen: "DK", prague: "CZ",
  // Elsewhere
  sydney: "AU", melbourne: "AU", tokyo: "JP", "tel aviv": "IL", dubai: "AE", "sao paulo": "BR", "mexico city": "MX",
  crimea: "UA", donetsk: "UA", luhansk: "UA", kherson: "UA", zaporizhzhia: "UA",
  // India
  bangalore: "IN", bengaluru: "IN", delhi: "IN", "new delhi": "IN", mumbai: "IN", hyderabad: "IN", pune: "IN", chennai: "IN", gurgaon: "IN", gurugram: "IN", noida: "IN", kolkata: "IN", ahmedabad: "IN",
};

const EU = ["IE", "DE", "FR", "NL", "ES", "PT", "IT", "PL", "SE", "BE", "AT", "DK", "FI", "CZ", "RO"];
export const REGIONS: Record<string, string[]> = { europe: [...EU, "UK", "CH", "NO"], eu: EU, "european union": EU, "north america": ["US", "CA"] };

export const words = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
export const has = (text: string, phrase: string) => words(text).includes(` ${phrase} `);

// "us" and "u s" are also the pronoun ("let us know"): they count as the country only written in capitals.
const PRONOUN_LIKE = new Set(["us", "u s"]);
const namesCountry = (text: string, name: string) => (PRONOUN_LIKE.has(name) ? /\bU\.?\s?S\b(?!\.?\s?[a-z])/.test(text) : has(text, name));

/** The country code of a country's name ("India", "USA"), or null. */
export function countryCode(name: string | null | undefined) {
  if (!name) return null;
  const text = words(name).trim();
  for (const [code, names] of Object.entries(COUNTRIES)) if (names.includes(text)) return code;
  return null;
}

/** Countries a question names: by country, region or a place inside one; `inside` holds the codes named by a place inside them. */
export function placesNamed(text: string) {
  const codes = new Set<string>();
  const inside = new Set<string>();
  for (const [code, names] of Object.entries(COUNTRIES)) if (names.some((name) => namesCountry(text, name))) codes.add(code);
  for (const [region, list] of Object.entries(REGIONS)) if (has(text, region)) list.forEach((code) => codes.add(code));
  for (const [place, code] of Object.entries(SUB_REGIONS)) {
    if (!has(text, place)) continue;
    inside.add(code);
    codes.add(code);
  }
  // "New Mexico", "New South Wales": the longer name is the place.
  if (has(text, "new mexico")) codes.delete("MX");
  if (has(text, "new south wales")) codes.delete("UK");
  return { codes, inside };
}

// Job.country (tagging.ts) for the profile's home: IN and US are their own, everything else is OTHER.
const JOB_COUNTRY: Record<string, string> = { IN: "IN", US: "US" };

/**
 * Whether a question is about a place outside the candidate's home country: the places the question names decide;
 * a question that names none is about the job's place (Job.country; a remote job has none). Null when unknown.
 */
export function outsideHomeCountry(question: string, profileCountry: string | null | undefined, jobCountry: string | null | undefined): boolean | null {
  const home = countryCode(profileCountry);
  if (!home) return null;
  const { codes } = placesNamed(question);
  if (codes.size > 0) return !codes.has(home);
  if (!jobCountry || jobCountry === "REMOTE") return null;
  const homeJob = JOB_COUNTRY[home] ?? "OTHER";
  if (homeJob === "OTHER") return null;
  return jobCountry !== homeJob;
}
