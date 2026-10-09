import { z } from "zod";
import { db } from "@/lib/db";
import { daysAgoLabel } from "@/lib/days";
import { appliedRoleKeys, companyKey, loadRules, roleKey } from "@/modules/governance";
import { companyResultsById, judge } from "./results";
import { requiredYears } from "./tagging";

export { daysAgoLabel };

// Boards with a working apply adapter (modules/apply/pick.ts).
export const APPLY_BOARDS = ["greenhouse", "lever", "ashby"] as const;
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

export function scoreJob(
  job: {
    title: string;
    description: string;
    country: string;
    remoteType: string;
    experienceMin: number | null;
  },
  candidate: {
    currentTitle: string | null;
    skills: string[];
    yearsExperience: number | null;
    preferredLocations: string[];
  },
) {
  const title = job.title.toLowerCase();
  const description = job.description.toLowerCase();
  const jobTitleTokens = new Set(titleTokens(job.title));
  const candidateTitleTokens = [...new Set(titleTokens(candidate.currentTitle ?? ""))];
  const titleOverlap = candidateTitleTokens.filter((token) => jobTitleTokens.has(token));
  const skillsInTitle = candidate.skills.filter((skill) => mentions(title, skill));
  const titleHits = [...(titleOverlap.length > 0 && candidate.currentTitle ? [candidate.currentTitle] : []), ...skillsInTitle];
  const titleRatio = candidateTitleTokens.length === 0 ? 0 : titleOverlap.length / candidateTitleTokens.length;
  const titleScore = Math.round(40 * Math.min(1, titleRatio + 0.5 * skillsInTitle.length));

  const skillHits = candidate.skills.filter((skill) => mentions(title, skill) || mentions(description, skill));
  const skillTarget = Math.min(candidate.skills.length, SKILLS_FOR_FULL_SCORE);
  const skillScore = skillTarget === 0 ? 0 : Math.round(30 * Math.min(1, skillHits.length / skillTarget));

  // What the posting really asks for comes from its title and text, never from a stored guess.
  const asks = requiredYears(job.title, job.description);
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

export async function listFeed(userId: string, filters: FeedFilters): Promise<FeedJob[]> {
  // Independent reads run together: every database round trip is ~250 ms from India to the database.
  const [profile, answers, swipes] = await Promise.all([
    db.profile.findUnique({ where: { userId } }),
    db.answer.findMany({ where: { userId, key: "preferred_location" }, select: { answer: true } }),
    db.swipe.findMany({ where: { userId }, select: { jobId: true } }),
  ]);
  const skills = skillsSchema.safeParse(profile?.skills).success ? skillsSchema.parse(profile?.skills) : [];
  const preferred = (answers[0]?.answer ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item === "India" || item === "US" || item === "Other");

  const cutoff = new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000);
  const sources = profile?.isTest ? [...new Set([...filters.boards, "mock"])] : filters.boards;
  const [jobs, applied, results] = await Promise.all([
    db.job.findMany({
      where: {
        source: { in: sources },
        country: { in: filters.countries },
        postedAt: { gte: cutoff },
        closedAt: null,
        id: { notIn: swipes.map((swipe) => swipe.jobId) },
      },
      select: {
        id: true,
        title: true,
        location: true,
        source: true,
        country: true,
        remoteType: true,
        experienceMin: true,
        description: true,
        applyUrl: true,
        postedAt: true,
        companyId: true,
        company: { select: { name: true } },
      },
    }),
    appliedRoleKeys(userId),
    companyResultsById().catch(() => new Map<string, never>()),
  ]);

  // Jobs below the governance minimum would be blocked on swipe anyway, so they never reach the deck.
  const minScore = loadRules().min_match_score;

  const scored = jobs
    .map((job) => {
      const match = scoreJob(job, {
        currentTitle: profile?.currentTitle ?? null,
        skills,
        yearsExperience: profile?.yearsExperience ?? null,
        preferredLocations: preferred,
      });
      return {
        id: job.id,
        title: job.title,
        company: job.company.name,
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
        roleKey: roleKey(companyKey(job.company.name), job.title),
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
    .sort((a, b) => b.rank - a.rank || b.score - a.score || a.daysAgo - b.daysAgo)
    .map(({ rank, ...job }) => {
      void rank;
      return job;
    })
    .slice(0, 40);
}
