/**
 * What kind of job a posting is (T81), from its title: a function, a track inside it and a seniority level. Tech first
 * (owner, 10 Oct): every tech specialty has its own track, so a data scientist is matched with data science roles, a
 * security engineer with security roles. Everything else is `non_tech` for now; other fields are new entries here
 * later (T85). Rules only, in order (the first track whose pattern the title matches wins), so the same title always
 * gets the same answer. Check: scripts/functions-test.ts.
 */

export const TRACKS = [
  "ml_ai",
  "data_science",
  "data_engineering",
  "security",
  "devops",
  "mobile",
  "frontend",
  "backend",
  "fullstack",
  "qa",
  "embedded",
  "solutions",
  "eng_management",
  "software",
] as const;
export type Track = (typeof TRACKS)[number];
export type JobFunction = "engineering" | "data_ai" | "non_tech";

export const TRACK_LABELS: Record<Track, string> = {
  ml_ai: "ML / AI",
  data_science: "Data science & analytics",
  data_engineering: "Data engineering",
  security: "Security",
  devops: "DevOps / SRE / Cloud",
  mobile: "Mobile",
  frontend: "Frontend",
  backend: "Backend",
  fullstack: "Full-stack",
  qa: "QA / Test",
  embedded: "Embedded / Hardware",
  solutions: "Solutions / Support engineering",
  eng_management: "Engineering management",
  software: "Software engineering",
};

const FUNCTION_OF: Record<Track, JobFunction> = {
  ml_ai: "data_ai",
  data_science: "data_ai",
  data_engineering: "data_ai",
  security: "engineering",
  devops: "engineering",
  mobile: "engineering",
  frontend: "engineering",
  backend: "engineering",
  fullstack: "engineering",
  qa: "engineering",
  embedded: "engineering",
  solutions: "engineering",
  eng_management: "engineering",
  software: "engineering",
};

// Tracks close enough that a candidate in one is a fair match for the other.
export const ADJACENT: Record<Track, Track[]> = {
  ml_ai: ["data_science", "data_engineering", "software"],
  data_science: ["ml_ai", "data_engineering"],
  data_engineering: ["data_science", "backend", "ml_ai"],
  security: ["devops"],
  devops: ["backend", "security"],
  mobile: ["frontend", "fullstack"],
  frontend: ["fullstack", "mobile", "software"],
  backend: ["fullstack", "software", "data_engineering"],
  fullstack: ["frontend", "backend", "software"],
  qa: ["software"],
  embedded: ["software"],
  solutions: ["software"],
  eng_management: [],
  software: ["backend", "fullstack", "frontend"],
};

// Titles that are not engineering even though they contain a tech word ("Product Manager, Payments Platform",
// "Recruiter, Engineering", "Sales Development Representative").
const NOT_TECH =
  /\b(recruit\w*|talent|sourcer|people partner|people (systems|technology|operations)|systems administrator|sysadmin|it support|hr\b|human resources|payroll|account executive|account manager|sales(?!\s+engineer)|business development|\bsdr\b|\bbdr\b|marketing|marketer|brand|content (writer|strategist|designer|manager)|copywriter|communications|public relations|legal|counsel|paralegal|attorney|compliance (manager|analyst|officer|specialist)|finance|financial|accountant|accounting|controller|tax\b|treasury|fp&a|audit\w*|procurement|office manager|executive assistant|administrative|receptionist|facilities|customer success|customer support (specialist|representative|associate|agent)|support (specialist|representative|agent)|community|partnerships?|operations (manager|associate|specialist|analyst|lead)|program manager|project manager|product manager|product owner|product marketing|product designer|product design|ux (designer|researcher|writer|research)|ui designer|visual designer|graphic designer|designer|creative|writer|editor|policy|strategy|chief of staff|consultant(?! engineer))\b/i;

// The first match wins: specialties before the general ones ("Machine Learning Platform Engineer" is ML, "Senior
// Backend Engineer, Data" is backend only when nothing more specific matches first).
const RULES: Array<[Track, RegExp]> = [
  ["eng_management", /\b(engineering manager|manager( i{1,3}| [1-3])?,? [a-z /&-]{0,30}engineering|software (development|engineering) manager|director,? (of )?engineering|engineering director|head of (engineering|platform|infrastructure|data|security|ai|ml)|vp,? (of )?engineering|cto)\b/i],
  ["solutions", /\b(solutions? (engineer|architect|consultant)|sales engineer|support engineer|technical support|customer engineer|forward deployed|implementation engineer|professional services engineer|(customer|partner|value|enablement|technical success|technical) architect|integration engineer|technical account manager|field engineer|developer advocate|developer relations|devrel)\b/i],
  ["ml_ai", /\b(machine learning|ml|mlops|ai|a\.i\.|artificial intelligence|genai|gen ai|generative|llms?|nlp|natural language|computer vision|deep learning|applied scientist|research scientist|research engineer|ai\/ml|ml\/ai|perception|speech|recommendation|recommender|ranking|search relevance)\b/i],
  ["security", /\b(security|appsec|secops|soc|siem|cyber\w*|infosec|penetration|pentest\w*|red team|blue team|threat|vulnerability|identity and access|iam|incident response|detection|cryptograph\w*|privacy engineer|trust (and|&) safety engineer)\b/i],
  ["data_science", /\b(data scien\w*|data analyst|product analyst|business analyst|bi analyst|insights analyst|analytics|business intelligence|\bbi\b|statistician|quantitative|decision scien\w*|experimentation)\b/i],
  ["data_engineering", /\b(data engineer\w*|data platform|data infrastructure|etl|big data|data warehouse|analytics engineer|database|dba|data pipeline)\b/i],
  ["embedded", /\b(embedded|firmware|hardware|fpga|asic|silicon|electrical engineer|rtl|verification engineer|robotics|kernel|drivers?)\b/i],
  ["devops", /\b(devops|dev ops|sre|site reliability|reliability|infrastructure|infra|platform engineer\w*|cloud|kubernetes|(?<!distributed )systems engineer|production engineer|build engineer|release engineer|network engineer|linux|observability|developer productivity|developer experience|devex)\b/i],
  ["mobile", /\b(mobile|ios|android|react native|flutter|swift|kotlin)\b/i],
  ["frontend", /\b(front[- ]?end|frontend|ui engineer|ux engineer|web engineer|web developer|javascript engineer|react engineer|design engineer)\b/i],
  ["fullstack", /\b(full[- ]?stack|fullstack|mern|mean stack)\b/i],
  ["backend", /\b(back[- ]?end|backend|server|api|distributed systems|java engineer|golang|go engineer|python engineer|payments engineer)\b/i],
  ["qa", /\b(qa|quality assurance|quality engineer|test engineer|sdet|test automation|automation engineer|tester|engineer in test)\b/i],
  ["software", /\b(software|engineer|engineering|developer|programmer|swe|sde|architect|coder|technical lead|tech lead)\b/i],
];

export const SENIORITIES = ["intern", "entry", "mid", "senior", "staff", "manager"] as const;
export type Seniority = (typeof SENIORITIES)[number];

/** The level a title states, or null when it states none ("Software Engineer"). */
export function seniorityOf(title: string): Seniority | null {
  const t = title.replace(/[‐-―]/g, "-");
  if (/\b(intern|internship|co-?op|trainee|apprentice|working student)\b/i.test(t)) return "intern";
  if (/\b(director|head of|vp|vice president|chief|cto|ceo|manager|management)\b/i.test(t)) return "manager";
  if (/\b(staff|principal|distinguished|fellow|architect|lead|leader)\b/i.test(t)) return "staff";
  if (/\b(senior|sr\.?|iii|iv|level (3|4|5)|sde[- ]?(3|iii)|engineer\W{0,3}(3|4)|expert)\b/i.test(t)) return "senior";
  if (/\b(ii|level 2|sde[- ]?(2|ii)|engineer\W{0,3}2|intermediate|mid[- ]level)\b/i.test(t)) return "mid";
  if (/\b(new grad\w*|graduate|grad|entry[- ]level|entry|junior|jr\.?|early career|early in career|campus|university|fresher|i|level 1|sde[- ]?(1|i)|engineer 1|associate (software|engineer|developer|data|ml|machine|security|cloud|qa|test))\b/i.test(t)) return "entry";
  return null;
}

/** Function, track and seniority of a posting from its title; a non-tech title has track null. */
export function classifyTitle(title: string): { function: JobFunction; track: Track | null; seniority: Seniority | null } {
  const seniority = seniorityOf(title);
  // "Engineering Manager" is tech even though it says manager; "Product Manager, Infrastructure" is not.
  const management = RULES[0][1].test(title);
  if (!management && NOT_TECH.test(title)) return { function: "non_tech", track: null, seniority };
  for (const [track, pattern] of RULES) if (pattern.test(title)) return { function: FUNCTION_OF[track], track, seniority };
  return { function: "non_tech", track: null, seniority };
}

// Skills that point to a track on their own, for reading a candidate's tracks from their resume.
const SKILL_TRACKS: Array<[Track, RegExp]> = [
  ["ml_ai", /^(pytorch|tensorflow|keras|scikit-learn|sklearn|hugging ?face|transformers|langchain|llamaindex|llms?|nlp|computer vision|opencv|deep learning|machine learning|mlops|mlflow|xgboost|generative ai|rag)$/i],
  ["data_science", /^(pandas|numpy|statistics|r|tableau|power ?bi|looker|a\/b testing|excel|data analysis|data visualization|spss|stata)$/i],
  ["data_engineering", /^(spark|pyspark|airflow|kafka|dbt|snowflake|bigquery|redshift|hadoop|databricks|etl|flink)$/i],
  ["security", /^(siem|splunk|burp suite|metasploit|nmap|wireshark|penetration testing|owasp|iam|soc|incident response|kali linux|threat modeling|vulnerability assessment)$/i],
  ["devops", /^(kubernetes|k8s|terraform|ansible|jenkins|ci\/cd|helm|prometheus|grafana|aws|gcp|azure|docker)$/i],
  ["mobile", /^(swift|swiftui|kotlin|android|ios|flutter|react native|dart|objective-c)$/i],
  ["frontend", /^(react|react\.js|reactjs|vue|vue\.js|angular|next\.js|nextjs|html|css|tailwind|tailwind css|redux|javascript|typescript)$/i],
  ["backend", /^(node\.js|nodejs|express|express\.js|django|flask|fastapi|spring|spring boot|java|go|golang|rust|postgresql|postgres|mongodb|mysql|redis|graphql|rest|microservices)$/i],
  ["qa", /^(selenium|cypress|playwright|jest|testng|junit|appium|manual testing|test automation)$/i],
  ["embedded", /^(embedded c|rtos|verilog|vhdl|fpga|arduino|raspberry pi|microcontrollers|firmware)$/i],
];

/**
 * A candidate's tracks from their titles and skills: the tracks of their current and past titles first, then the
 * tracks most of their skills point to. Frontend plus backend skills read as full-stack. The user confirms them.
 */
export function tracksFromProfile(input: { currentTitle: string | null; experienceTitles: string[]; skills: string[] }): Track[] {
  const out: Track[] = [];
  const add = (track: Track | null) => {
    if (track && !out.includes(track)) out.push(track);
  };
  for (const title of [input.currentTitle ?? "", ...input.experienceTitles]) {
    const { track } = classifyTitle(title);
    if (track && track !== "software" && track !== "eng_management") add(track);
  }
  const counts = new Map<Track, number>();
  for (const skill of input.skills) for (const [track, pattern] of SKILL_TRACKS) if (pattern.test(skill.trim())) counts.set(track, (counts.get(track) ?? 0) + 1);
  if ((counts.get("frontend") ?? 0) >= 2 && (counts.get("backend") ?? 0) >= 2) add("fullstack");
  // Developers list test runners and cloud tools too: QA and DevOps need more of them to count as a track.
  const needed = (track: Track) => (track === "qa" || track === "devops" ? 3 : 2);
  for (const [track, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) if (n >= needed(track)) add(track);
  if (out.length === 0) add(classifyTitle(input.currentTitle ?? "").track);
  if (out.length === 0) add("software");
  return out.slice(0, 4);
}

/** Whether a job's track fits the candidate's: the same track, an adjacent one, or general software for a developer. */
export function trackFit(jobTrack: string | null, mine: string[]): "same" | "adjacent" | "none" {
  if (!jobTrack) return "none";
  if (mine.includes(jobTrack)) return "same";
  if (mine.some((track) => (ADJACENT[track as Track] ?? []).includes(jobTrack as Track))) return "adjacent";
  return "none";
}

/** The tracks a profile is matched on: the ones the user confirmed, else the ones its titles and skills suggest. */
export function tracksOf(profile: { tracks?: string[] | null; currentTitle: string | null; skills: unknown; experience: unknown }): string[] {
  const saved = (profile.tracks ?? []).filter((track) => (TRACKS as readonly string[]).includes(track));
  if (saved.length > 0) return saved;
  const skills = Array.isArray(profile.skills) ? profile.skills.filter((skill): skill is string => typeof skill === "string") : [];
  const experienceTitles = Array.isArray(profile.experience)
    ? (profile.experience as Array<{ title?: unknown }>).map((role) => (typeof role?.title === "string" ? role.title : "")).filter(Boolean)
    : [];
  return tracksFromProfile({ currentTitle: profile.currentTitle, experienceTitles, skills });
}
