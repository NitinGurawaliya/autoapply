import { z } from "zod";
import { db } from "@/lib/db";
import { daysAgoLabel } from "@/lib/days";
import { appliedRoleKeys, companyKey, loadRules, roleKey } from "@/modules/governance";
import { companyResultsById, judge } from "./results";
import { requiredYears } from "./tagging";

export { daysAgoLabel };

// Boards the agent applies on: the feed, its filters, swipes, retries and the runner all read this list.
// Lever and Ashby adapters exist (modules/apply/adapters) but are switched off until they submit reliably
// (hCaptcha on Lever, reCAPTCHA spam refusals on Ashby); their jobs are still ingested. Add them back here to switch on.
export const APPLY_BOARDS = ["greenhouse"] as const;
const BOARDS = APPLY_BOARDS;
const COUNTRIES = ["IN", "US", "REMOTE", "OTHER"] as const;

const skillsSchema = z.array(z.string());

export type FeedFilters = {
  boards: string[];
  countries: string[];
  expMax: number | null;
  days: number;
};

export type FeedJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  country: string;
  applyUrl: string;
  daysAgo: number;
  score: number;
  reason: string;
  remoteType: string;
  requiredYears: number | null;
  skillHits: string[];
  /** What past applications to this company taught us, when it is worth saying. */
  hint: string | null;
};

const COUNTRY_ALIASES: Record<string, (typeof COUNTRIES)[number]> = {
  in: "IN",
  india: "IN",
  us: "US",
  usa: "US",
  remote: "REMOTE",
  other: "OTHER",
};

function listParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.flatMap((item) => item.split(","));
  if (!value) return [];
  return value.split(",");
}

export function parseFeedFilters(input: {
  boards?: string | string[];
  country?: string | string[];
  expMax?: string | string[];
  days?: string | string[];
}): FeedFilters {
  const boards = listParam(input.boards)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => (BOARDS as readonly string[]).includes(item));
  const countries = listParam(input.country)
    .map((item) => COUNTRY_ALIASES[item.trim().toLowerCase()])
    .filter((item): item is (typeof COUNTRIES)[number] => Boolean(item));
  const expRaw = listParam(input.expMax)[0];
  const daysRaw = listParam(input.days)[0];
  const expMax = expRaw != null && expRaw !== "" && Number.isFinite(Number(expRaw)) ? Number(expRaw) : null;
  const daysNum = daysRaw != null && Number.isFinite(Number(daysRaw)) ? Number(daysRaw) : 30;
  return {
    boards: boards.length > 0 ? boards : [...BOARDS],
    countries: countries.length > 0 ? [...new Set(countries)] : [...COUNTRIES],
    expMax,
    days: Math.min(Math.max(daysNum, 1), 365),
  };
}

function tokens(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((token) => token.length > 1);
}

const ROLE_ALIASES: Record<string, string> = { developer: "engineer", dev: "engineer", programmer: "engineer", swe: "engineer" };
// A resume lists dozens of skills; a job needs only a handful to be a strong match.
const SKILLS_FOR_FULL_SCORE = 8;

function titleTokens(value: string) {
  return tokens(value).map((token) => ROLE_ALIASES[token] ?? token);
}

function mentions(text: string, needle: string) {
  const escaped = needle.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return new RegExp(`(^|[^a-z0-9+#])${escaped}($|[^a-z0-9+#])`).test(text);
}

function clamp(score: number) {
  return Math.max(0, Math.min(100, score));
}

type Candidate = {
  currentTitle: string | null;
  skills: string[];
  yearsExperience: number | null;
  preferredLocations: string[];
};

export function scoreJob(
  job: {
    title: string;
    description: string;
    country: string;
    remoteType: string;
    experienceMin: number | null;
  },
  candidate: Candidate,
) {
  const title = job.title.toLowerCase();
  const description = job.description.toLowerCase();
  const skillHits = candidate.skills.filter((skill) => mentions(title, skill) || mentions(description, skill));
  // What the posting really asks for comes from its title and text, never from a stored guess.
  return scoreFeatures({ title: job.title, country: job.country, remoteType: job.remoteType, requiredYears: requiredYears(job.title, job.description), skillHits }, candidate);
}

/**
 * The score from a job's features: which of the candidate's skills it mentions and the years it asks for. scoreJob
 * finds them in the description; the feed finds them in Postgres (feedRows) so descriptions never leave the database.
 */
export function scoreFeatures(
  job: { title: string; country: string; remoteType: string; requiredYears: number | null; skillHits: string[] },
  candidate: Candidate,
) {
  const title = job.title.toLowerCase();
  const skillHits = job.skillHits;
  const jobTitleTokens = new Set(titleTokens(job.title));
  const candidateTitleTokens = [...new Set(titleTokens(candidate.currentTitle ?? ""))];
  const titleOverlap = candidateTitleTokens.filter((token) => jobTitleTokens.has(token));
  const skillsInTitle = candidate.skills.filter((skill) => mentions(title, skill));
  const titleHits = [...(titleOverlap.length > 0 && candidate.currentTitle ? [candidate.currentTitle] : []), ...skillsInTitle];
  const titleRatio = candidateTitleTokens.length === 0 ? 0 : titleOverlap.length / candidateTitleTokens.length;
  const titleScore = Math.round(40 * Math.min(1, titleRatio + 0.5 * skillsInTitle.length));

  const skillTarget = Math.min(candidate.skills.length, SKILLS_FOR_FULL_SCORE);
  const skillScore = skillTarget === 0 ? 0 : Math.round(30 * Math.min(1, skillHits.length / skillTarget));

  const asks = job.requiredYears;
  const have = candidate.yearsExperience ?? 0;
  const gap = asks == null ? 0 : asks - have;
  const experienceScore = asks == null ? 14 : gap <= 0 ? 20 : gap === 1 ? 16 : gap === 2 ? 8 : gap === 3 ? 2 : 0;
  // A big seniority gap can't be offset by a matching title or skills.
  const ceiling = gap >= 4 ? 25 : gap === 3 ? 35 : gap === 2 ? 50 : 100;

  const prefs = candidate.preferredLocations;
  let locationScore = 10;
  if (prefs.length > 0 && job.country !== "REMOTE" && job.remoteType !== "remote") {
    const fits =
      (prefs.includes("India") && job.country === "IN") ||
      (prefs.includes("US") && job.country === "US") ||
      (prefs.includes("Other") && job.country === "OTHER");
    locationScore = fits ? 10 : 0;
  }

  const parts: string[] = [];
  if (titleHits.length > 0) parts.push(`Title matches ${titleHits.slice(0, 2).join(", ")}`);
  if (skillHits.length > 0) parts.push(`Skills: ${skillHits.slice(0, 3).join(", ")}`);
  if (gap >= 2 && asks != null) parts.unshift(`Asks for about ${asks}+ years, you have ${have}`);
  else if (asks != null && gap <= 0) parts.push("Experience fits");
  else if (asks != null) parts.push("Experience is close");
  if (locationScore === 10 && prefs.length > 0) parts.push("Location fits");

  return {
    score: Math.min(ceiling, clamp(titleScore + skillScore + experienceScore + locationScore)),
    reason: parts.slice(0, 2).join(". ") || "Little overlap with your profile.",
    requiredYears: asks,
    skillHits,
  };
}

function daysAgo(postedAt: Date) {
  const elapsed = Date.now() - postedAt.getTime();
  return Math.max(0, Math.floor(elapsed / (24 * 60 * 60 * 1000)));
}

/** Boards we can apply through, best first; when one role is listed on two of them, the best listing is the card. */
const BOARD_RANK: Record<string, number> = { greenhouse: 0, ashby: 1, lever: 2, mock: 3 };

/** Keeps one listing per company, title and place, so one role listed on two boards is one card. */
export function dedupeListings<T extends { roleKey: string; location: string; source: string; daysAgo: number }>(rows: T[]) {
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.roleKey}|${row.location.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    const current = best.get(key);
    const better =
      !current ||
      (BOARD_RANK[row.source] ?? 9) < (BOARD_RANK[current.source] ?? 9) ||
      ((BOARD_RANK[row.source] ?? 9) === (BOARD_RANK[current.source] ?? 9) && row.daysAgo < current.daysAgo);
    if (better) best.set(key, row);
  }
  return rows.filter((row) => best.get(`${row.roleKey}|${row.location.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`) === row);
}

type FeedRow = {
  id: string;
  title: string;
  location: string;
  source: string;
  country: string;
  remoteType: string;
  experienceMin: number | null;
  applyUrl: string;
  postedAt: Date;
  companyId: string;
  company: string;
  hits: number[];
};

/** The SQL regex for mentions(): the skill as literal text between two non-word characters (or the text's ends). */
function skillPattern(needle: string) {
  const literal = needle.replace(/[^a-z0-9 ]/g, (c) => (c === "^" || c === "\\" ? `\\${c}` : `[${c}]`));
  return `(^|[^a-z0-9+#])${literal}($|[^a-z0-9+#])`;
}

/**
 * The feed's candidate jobs, read without their descriptions: Postgres finds which of the candidate's skills each job
 * mentions (`hits`, indexes into `skills`), exactly as mentions() would. A one-word skill is a lookup in the GIN index
 * on the job's `terms` (its distinct words, kept by a trigger); a skill with dots, slashes or spaces ("Node.js") is
 * checked with the same regex, only on jobs whose terms hold all its words. With a minimum score above 30, a job with no skill
 * and no title word in common is left out here: experience and location alone (20 + 10) cannot reach it.
 */
export async function feedRows(input: {
  userId: string;
  sources: string[];
  countries: string[];
  cutoff: Date;
  expMax: number | null;
  skills: string[];
  titleWords: string[];
  prefilter: boolean;
}) {
  // One row per skill: its words (all must be among the job's words, looked up in the GIN index on terms) and, for
  // a skill that is more than one word, the regex that then checks they appear in that exact spelling.
  const indexes: number[] = [];
  const parts: string[] = [];
  const patterns: string[] = [];
  input.skills.forEach((skill, index) => {
    const needle = skill.toLowerCase().trim();
    if (!needle) return;
    indexes.push(index);
    parts.push(needle.split(/[^a-z0-9+#]+/).filter(Boolean).join(" "));
    patterns.push(/^[a-z0-9+#]+$/.test(needle) ? "" : skillPattern(needle));
  });
  return db.$queryRaw<FeedRow[]>`
    WITH skill AS (
      SELECT * FROM unnest(${indexes}::int[], ${parts}::text[], ${patterns}::text[]) AS s(i, parts, pattern)
    ),
    hit AS (
      SELECT j.id, array_agg(s.i) AS hits
      FROM skill s
      JOIN "Job" j ON j.terms @> string_to_array(s.parts, ' ')
      WHERE s.pattern = '' OR lower(j.title || chr(10) || j.description) ~ s.pattern
      GROUP BY j.id
    ),
    candidates AS (
      SELECT j.id, j.title, j.location, j.source, j.country, j."remoteType", j."experienceMin", j."applyUrl", j."postedAt",
             j."companyId", c.name AS company, coalesce(h.hits, '{}') AS hits
      FROM "Job" j
      JOIN "Company" c ON c.id = j."companyId"
      LEFT JOIN hit h ON h.id = j.id
      WHERE j.source = ANY(${input.sources}::text[])
        AND j.country = ANY(${input.countries}::text[])
        AND j."postedAt" >= ${input.cutoff}
        AND j."closedAt" IS NULL
        AND (${input.expMax}::int IS NULL OR j."experienceMin" IS NULL OR j."experienceMin" <= ${input.expMax}::int)
        AND NOT EXISTS (SELECT 1 FROM "Swipe" s WHERE s."userId" = ${input.userId} AND s."jobId" = j.id)
    )
    SELECT * FROM candidates
    WHERE NOT ${input.prefilter}
       OR source = 'mock'
       OR cardinality(hits) > 0
       OR regexp_split_to_array(lower(title), '[^a-z0-9+#]+') && ${input.titleWords}::text[]
    ORDER BY id`;
}

/** Every word in a job title that titleTokens() would count as one of the candidate's title words (aliases included). */
function titleWordsFor(currentTitle: string | null) {
  const wanted = new Set(titleTokens(currentTitle ?? ""));
  const aliases = Object.entries(ROLE_ALIASES).filter(([, to]) => wanted.has(to)).map(([from]) => from);
  return [...wanted, ...aliases];
}

export async function listFeed(userId: string, filters: FeedFilters): Promise<FeedJob[]> {
  // Independent reads run together: every database round trip is ~250 ms from India to the database.
  const [profile, answers] = await Promise.all([
    db.profile.findUnique({ where: { userId } }),
    db.answer.findMany({ where: { userId, key: "preferred_location" }, select: { answer: true } }),
  ]);
  const skills = skillsSchema.safeParse(profile?.skills).success ? skillsSchema.parse(profile?.skills) : [];
  const preferred = (answers[0]?.answer ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item === "India" || item === "US" || item === "Other");

  // Jobs below the governance minimum would be blocked on swipe anyway, so they never reach the deck.
  const minScore = loadRules().min_match_score;
  const cutoff = new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000);
  const sources = profile?.isTest ? [...new Set([...filters.boards, "mock"])] : filters.boards;
  const [jobs, applied, results] = await Promise.all([
    feedRows({
      userId,
      sources,
      countries: filters.countries,
      cutoff,
      expMax: filters.expMax,
      skills,
      titleWords: titleWordsFor(profile?.currentTitle ?? null),
      prefilter: minScore > 30,
    }),
    appliedRoleKeys(userId),
    companyResultsById().catch(() => new Map<string, never>()),
  ]);

  const scored = jobs
    .map((job) => {
      const hits = new Set(job.hits);
      const match = scoreFeatures(
        { title: job.title, country: job.country, remoteType: job.remoteType, requiredYears: job.experienceMin, skillHits: skills.filter((_, index) => hits.has(index)) },
        {
          currentTitle: profile?.currentTitle ?? null,
          skills,
          yearsExperience: profile?.yearsExperience ?? null,
          preferredLocations: preferred,
        },
      );
      return {
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        source: job.source,
        country: job.country,
        applyUrl: job.applyUrl,
        daysAgo: daysAgo(job.postedAt),
        score: match.score,
        reason: match.reason,
        requiredYears: match.requiredYears,
        skillHits: match.skillHits.slice(0, 4),
        remoteType: job.remoteType,
        roleKey: roleKey(companyKey(job.company), job.title),
        verdict: judge(results.get(job.companyId)),
        mock: job.source === "mock",
      };
    })
    .filter((job) => job.mock || job.score >= minScore)
    .filter((job) => !applied.has(job.roleKey))
    .filter((job) => filters.expMax == null || job.requiredYears == null || job.requiredYears <= filters.expMax);

  return dedupeListings(scored)
    .map((job) => ({
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      source: job.source,
      country: job.country,
      applyUrl: job.applyUrl,
      daysAgo: job.daysAgo,
      score: job.score,
      reason: job.reason,
      remoteType: job.remoteType,
      requiredYears: job.requiredYears,
      skillHits: job.skillHits,
      hint: job.verdict.hint,
      // Ranking only: the number the user sees stays the honest match score.
      rank: job.score + job.verdict.nudge,
    }))
    // Rows arrive ordered by id, so equal-ranked cards (and duplicate listings) always come out the same way.
    .sort((a, b) => b.rank - a.rank || b.score - a.score || a.daysAgo - b.daysAgo)
    .map(({ rank, ...job }) => {
      void rank;
      return job;
    })
    .slice(0, 40);
}
