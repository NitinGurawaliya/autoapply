import { z } from "zod";
import { db } from "@/lib/db";
import { daysAgoLabel } from "@/lib/days";

export { daysAgoLabel };

// Boards with a working apply adapter (modules/apply/pick.ts). Lever and Ashby jobs are ingested but hidden until theirs exist.
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

  let experienceScore = 20;
  if (job.experienceMin != null) {
    if (candidate.yearsExperience == null) experienceScore = 0;
    else if (candidate.yearsExperience < job.experienceMin) {
      experienceScore = Math.round((20 * candidate.yearsExperience) / job.experienceMin);
    }
  }

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
  if (experienceScore === 20) parts.push("Experience fits");
  else if (experienceScore > 0) parts.push("Experience is close");
  if (locationScore === 10 && prefs.length > 0) parts.push("Location fits");

  return {
    score: clamp(titleScore + skillScore + experienceScore + locationScore),
    reason: parts.slice(0, 2).join(". ") || "Little overlap with your profile.",
  };
}

function daysAgo(postedAt: Date) {
  const elapsed = Date.now() - postedAt.getTime();
  return Math.max(0, Math.floor(elapsed / (24 * 60 * 60 * 1000)));
}

export async function listFeed(userId: string, filters: FeedFilters): Promise<FeedJob[]> {
  const profile = await db.profile.findUnique({ where: { userId } });
  const answers = await db.answer.findMany({
    where: { userId, key: "preferred_location" },
    select: { answer: true },
  });
  const swipes = await db.swipe.findMany({ where: { userId }, select: { jobId: true } });
  const skills = skillsSchema.safeParse(profile?.skills).success ? skillsSchema.parse(profile?.skills) : [];
  const preferred = (answers[0]?.answer ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item === "India" || item === "US" || item === "Other");

  const cutoff = new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000);
      const sources = profile?.isTest ? [...new Set([...filters.boards, "mock"])] : filters.boards;
      const jobs = await db.job.findMany({
        where: {
          source: { in: sources },
      country: { in: filters.countries },
      postedAt: { gte: cutoff },
      id: { notIn: swipes.map((swipe) => swipe.jobId) },
      ...(filters.expMax == null
        ? {}
        : { OR: [{ experienceMin: null }, { experienceMin: { lte: filters.expMax } }] }),
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
      company: { select: { name: true } },
    },
  });

  return jobs
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
      };
    })
    .sort((a, b) => b.score - a.score || a.daysAgo - b.daysAgo)
    .slice(0, 40);
}
