import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
// Leaf files, not the jobs index: modules/jobs/warm.ts builds the brief, so the index would import itself back.
import { TRACKS, tracksOf } from "@/modules/jobs/functions";
import { candidateSkills } from "@/modules/jobs/skills";

/**
 * The candidate brief (Phase P, P5; docs/relevance/TDD.md 4.1 item 6): what the agent knows about the candidate when it
 * judges fit (P6): tracks, nearby, years, current title, top skills and, since P6's option A (owner, 19 Nov: "give it
 * more about me"), the roles the profile lists (title and what they did, as the old judge reads them). Built by code
 * from the profile, never by a model, and never holding contact data: no name, email, phone or links (the title is
 * dropped if it looks like one; skills are vocabulary terms only; role text has emails, links, phone numbers and the
 * user's own name blanked; no company names, no raw resume text). Stored in CandidateBrief, its own table, so a rebuild leaves Profile.updatedAt
 * alone. `fitHash = md5(FIT_VERSION + briefJson(brief))`: the fit model is sent exactly `briefJson(brief)`, so any
 * change to what it reads, or to FIT_VERSION, re-judges; learned lines (P8) sit beside the brief, outside the hash.
 */

/** Bump when the fit prompt or what it reads changes: every stored verdict then re-judges. */
export const FIT_VERSION = "7";
const TOP_SKILLS = 12;
const TITLE_CHARS = 80;
const ROLES = 4;
const ROLE_CHARS = 300;

export const briefSchema = z.object({
  tracks: z.array(z.string()),
  nearby: z.boolean(),
  years: z.number().nullable(),
  title: z.string().nullable(),
  skills: z.array(z.string()),
  // What the candidate did in each listed role, newest first (P6 option A); briefs stored before it read as none.
  roles: z.array(z.object({ title: z.string(), did: z.string() })).default([]),
});
export type Brief = z.infer<typeof briefSchema>;

/**
 * A learned line and its dismissal (P8, learning.ts writes them). `kind` "rank" (the default): a line that lowers the
 * rank of a family's jobs, shown on /account; "ask": a question the feed asked (`at`), closed when answered.
 */
export const learnedSchema = z.array(
  z.object({
    id: z.string(),
    kind: z.enum(["rank", "ask"]).optional(),
    family: z.string(),
    note: z.string(),
    at: z.string(),
    dismissedAt: z.string().nullable().optional(),
  }),
);
export type LearnedLine = z.infer<typeof learnedSchema>[number];

// An email, a link or a phone number: such a "title" is a parsing slip and never goes into the brief.
// A domain counts only with a path ("linkedin.com/in/x"), so "ASP.NET" and "Node.js" stay skills.
const CONTACT = /@|https?:|www\.|\.(com|in|io|net|org|dev|me)\/|\+?\d[\d\s().-]{6,}\d/i;
// Emails and links in the resume text are blanked before skills are read from it ("github.com/name" is not a skill).
const CONTACT_TOKENS = /\S+@\S+|https?:\/\/\S+|www\.\S+|\S+\.(com|in|io|net|org|dev|me)\/\S*/gi;

type BriefSource = {
  tracks: string[];
  showNearby: boolean;
  yearsExperience: number | null;
  currentTitle: string | null;
  skills: unknown;
  experience: unknown;
  resumeText?: string | null;
  /** The user's own name, blanked wherever role text repeats it. */
  fullName?: string | null;
};

// A phone number anywhere in a text (the same shape CONTACT refuses in a title).
const PHONES = /\+?\d[\d\s().-]{6,}\d/g;

/** Role text without contact data: emails, links, phone numbers and the user's own name (each part of it) blanked. */
function withoutContact(text: string, fullName: string | null | undefined) {
  let out = text.replace(CONTACT_TOKENS, " ").replace(PHONES, " ");
  for (const part of (fullName ?? "").split(/\s+/).filter((word) => word.length >= 3)) {
    out = out.replace(new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

type Role = { title?: unknown; summary?: unknown; description?: unknown };
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** The listed roles as the fit reads them: title and what they did (summary), contact data blanked, company left out. */
function rolesOf(experience: unknown, fullName: string | null | undefined) {
  const roles = Array.isArray(experience) ? (experience as Role[]) : [];
  return roles
    .map((role) => ({
      title: withoutContact(text(role.title), fullName).slice(0, TITLE_CHARS),
      did: withoutContact(text(role.summary) || text(role.description), fullName).slice(0, ROLE_CHARS),
    }))
    .filter((role) => (role.title || role.did) && !CONTACT.test(role.title))
    .slice(0, ROLES);
}

/** The brief of a profile: pure, the same profile always gives the same brief in the same order. */
export function briefOf(profile: BriefSource): Brief {
  const tracks = tracksOf(profile).filter((track) => (TRACKS as readonly string[]).includes(track));
  const title = (profile.currentTitle ?? "").replace(/\s+/g, " ").trim().slice(0, TITLE_CHARS);
  // The user's own skills list first, in its order, then the vocabulary terms the resume text shows.
  const own = Array.isArray(profile.skills) ? profile.skills.filter((skill): skill is string => typeof skill === "string" && !CONTACT.test(skill)) : [];
  const listed = candidateSkills({ skills: own });
  const fromText = candidateSkills({ skills: [], resumeText: (profile.resumeText ?? "").replace(CONTACT_TOKENS, " ") });
  const skills = [...new Set([...listed, ...fromText])].slice(0, TOP_SKILLS);
  return {
    tracks,
    nearby: profile.showNearby,
    years: profile.yearsExperience ?? null,
    title: title && !CONTACT.test(title) ? title : null,
    skills,
    roles: rolesOf(profile.experience, profile.fullName),
  };
}

/** The exact JSON the fit model is sent: fixed key order, so a brief read back from jsonb serialises the same. */
export function briefJson(brief: Brief): string {
  return JSON.stringify({ tracks: brief.tracks, nearby: brief.nearby, years: brief.years, title: brief.title, skills: brief.skills, roles: (brief.roles ?? []).map((role) => ({ title: role.title, did: role.did })) });
}

export function fitHashOf(brief: Brief, version: string = FIT_VERSION): string {
  return createHash("md5").update(version + briefJson(brief)).digest("hex");
}

/**
 * Builds the user's brief from their profile and stores it when it changed (one statement; the learned lines and the
 * fit lease are never touched). Null when the user has no profile.
 */
export async function buildBrief(userId: string) {
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { tracks: true, showNearby: true, yearsExperience: true, currentTitle: true, skills: true, experience: true, resumeText: true, fullName: true },
  });
  if (!profile) return null;
  const brief = briefOf(profile);
  const fitHash = fitHashOf(brief);
  const changed = await db.$executeRaw`
    INSERT INTO "CandidateBrief" ("userId", "brief", "fitHash", "updatedAt")
    VALUES (${userId}, ${briefJson(brief)}::jsonb, ${fitHash}, now())
    ON CONFLICT ("userId") DO UPDATE SET "brief" = EXCLUDED."brief", "fitHash" = EXCLUDED."fitHash", "updatedAt" = now()
    WHERE "CandidateBrief"."fitHash" IS DISTINCT FROM EXCLUDED."fitHash"`;
  return { brief, fitHash, changed: changed > 0 };
}

/** The brief as /account and GET /api/brief show it: rebuilt first (a write only when it changed), learned lines kept. */
export async function currentBrief(userId: string) {
  const built = await buildBrief(userId);
  if (!built) return null;
  const row = await db.candidateBrief.findUnique({ where: { userId }, select: { learned: true, updatedAt: true } });
  const learned = learnedSchema.safeParse(row?.learned ?? []);
  return {
    brief: built.brief,
    learned: (learned.success ? learned.data : []).filter((line) => (line.kind ?? "rank") === "rank" && !line.dismissedAt),
    updatedAt: row?.updatedAt ?? new Date(),
  };
}
