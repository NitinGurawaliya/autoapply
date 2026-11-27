import { db } from "@/lib/db";
import type { BrowseFilters } from "@/lib/browse-url";
import { briefOf } from "@/modules/profile/brief";
import { fitJobs, fitOn } from "./fit";
import { tracksOf } from "./functions";
import { readingGateOn } from "./gate";
import { daysAgo, feedBoardsFor, feedRows, feedTracks, labelledSkills, levelsFor, scoreFeatures, titleWordsFor, yearsReach } from "./match";
import { profileFit, type ProfileFit } from "./profile-fit";
import { formatSalary } from "./salary";
import { judgeJobs, profileVector, type Judgement } from "./semantic";
import { candidateShows } from "./skills";
import { z } from "zod";

// All jobs (Phase X, docs/feed/TDD.md 4.3): every open job the filters find, a page at a time, each judged against the
// profile with profileFit. Today's picks (listFeed) stay as they are; this list has no 65 floor and no 5-card cap. Every
// row gets the cheap score (closeness, skills, years); the model judges only the page being looked at, so the cost
// follows what is seen, and its verdicts are cached for the feed too.

export const BROWSE_PAGE = 25;

export type BrowseCard = {
  id: string;
  title: string;
  company: string;
  companyId: string;
  employerId: string | null;
  /** The employer's company page (/companies/<slug>), when it has one. */
  employerSlug: string | null;
  logoUrl: string | null;
  location: string;
  remoteType: string;
  daysAgo: number;
  requiredYears: number | null;
  salary: string | null;
  isNew: boolean;
  source: string;
  fit: ProfileFit;
};

export type BrowsePage = { jobs: BrowseCard[]; total: number; page: number; pages: number };

const skillsSchema = z.array(z.string());

export async function browseJobs(userId: string, filters: BrowseFilters, page = 1): Promise<BrowsePage> {
  const profile = await db.profile.findUnique({ where: { userId } });
  if (!profile) return { jobs: [], total: 0, page: 1, pages: 1 };
  const skills = skillsSchema.safeParse(profile.skills).success ? skillsSchema.parse(profile.skills) : [];
  const shows = candidateShows(profile);
  const tracks = tracksOf(profile);
  const years = profile.yearsExperience ?? null;
  const [vector, boards] = await Promise.all([profileVector(profile), feedBoardsFor(userId)]);
  const own = feedTracks(tracks, profile.showNearby === true);
  const shown = filters.field === "profile" ? own : filters.field === "all" ? null : [filters.field];
  const gateOn = readingGateOn();
  const at = Math.max(1, Math.floor(page) || 1);
  const rows = await feedRows({
    userId,
    sources: profile.isTest ? [...new Set([...boards, "mock"])] : boards,
    countries: filters.countries,
    levelYears: null,
    // The person's own band until they widen the years; a number widens to it.
    band: filters.exp === "profile" ? { maxYears: yearsReach(years), levels: levelsFor(years) } : null,
    stages: filters.stages.length > 0 ? filters.stages : null,
    tracks: shown,
    vector,
    cutoff: new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000),
    expMax: typeof filters.exp === "number" ? filters.exp : null,
    skills,
    titleWords: titleWordsFor(profile.currentTitle),
    prefilter: false,
    readingGate: gateOn,
    avoid: gateOn ? (profile.avoid ?? []) : [],
    query: filters.q || null,
    // A typed role or a widened field: closeness to the resume ranks, it does not cut.
    minSimilarity: filters.q || filters.field !== "profile" ? 0 : undefined,
    payStated: filters.pay,
    includeSkipped: filters.skipped,
    page: { order: filters.sort, limit: BROWSE_PAGE, offset: (at - 1) * BROWSE_PAGE },
  });
  const total = rows[0]?.totalRows ?? 0;

  // The model judges this page only (cached): the fit path when it is on, else the old judge.
  const judgements = new Map<string, Judgement>();
  const ids = rows.filter((row) => row.source !== "mock").map((row) => row.id);
  if (ids.length > 0) {
    if (fitOn()) {
      const who = { userId, profileId: profile.id, brief: briefOf(profile), shows, years };
      for (const [id, verdict] of await fitJobs(who, ids, { judge: true, lease: false, lane: "interactive" }).catch(() => new Map())) judgements.set(id, verdict);
    } else {
      const texts = rows.filter((row) => ids.includes(row.id)).map((row) => ({ id: row.id, title: row.title, contentHash: row.contentHash }));
      for (const [id, judgement] of await judgeJobs(profile, texts).catch(() => new Map<string, Judgement>())) judgements.set(id, judgement);
    }
  }

  // The employer's name and mark (Phase W) over the board row's own, which for Workday is the tenant ("acme.wd5/External").
  const employerIds = [...new Set(rows.map((row) => row.employerId).filter((id): id is string => id != null))];
  const employers = new Map(
    (employerIds.length > 0 ? await db.employer.findMany({ where: { id: { in: employerIds } }, select: { id: true, slug: true, name: true, logoUrl: true } }) : []).map((employer) => [employer.id, employer]),
  );

  const who = { tracks, showNearby: profile.showNearby, avoid: profile.avoid ?? [], yearsExperience: years, shows };
  const jobs = rows.map((row): BrowseCard => {
    const hits = new Set(row.hits);
    const judgement = judgements.get(row.id) ?? null;
    // The score with the field part off: a job outside the person's fields keeps an honest number, and profileFit
    // names the field as the reason it does not match.
    const match = scoreFeatures(
      { title: row.title, track: row.track, seniority: row.seniority, similarity: row.similarity, judgement, country: row.country, remoteType: row.remoteType, requiredYears: row.experienceMin, skillHits: skills.filter((_, index) => hits.has(index)), jobSkills: labelledSkills(row) },
      { currentTitle: profile.currentTitle, skills, yearsExperience: years, preferredLocations: [], tracks: [...new Set([...tracks, ...(shown ?? [])])], shows },
      gateOn ? { job: { source: row.source, title: row.title, track: row.track, roleFamily: row.roleFamily, kind: row.kind, flags: row.flags, readingCurrent: row.readingCurrent, seniority: row.seniority }, tracks: null, avoid: profile.avoid ?? [], field: false } : undefined,
    );
    const fit = profileFit(
      { source: row.source, title: row.title, track: row.track, roleFamily: row.roleFamily, kind: row.kind, flags: row.flags, readingCurrent: row.readingCurrent, seniority: row.seniority, experienceMin: row.experienceMin, skills: row.skills, skillsRequired: labelledSkills(row).required },
      who,
      { score: match.score, verdictNo: judgement?.fit === "no", verdictReason: judgement?.why ?? null },
    );
    const employer = row.employerId ? employers.get(row.employerId) : undefined;
    return {
      id: row.id,
      title: row.title,
      company: employer?.name ?? row.company,
      companyId: row.companyId,
      employerId: row.employerId,
      employerSlug: employer?.slug ?? null,
      logoUrl: employer?.logoUrl ?? row.logoUrl,
      location: row.location,
      remoteType: row.remoteType,
      daysAgo: daysAgo(row.postedAt),
      requiredYears: match.requiredYears,
      salary: formatSalary({ min: row.salaryMin, max: row.salaryMax, currency: row.salaryCurrency, period: row.salaryPeriod }),
      isNew: Date.now() - row.firstSeenAt.getTime() < 24 * 60 * 60 * 1000 && Date.now() - row.postedAt.getTime() < 7 * 24 * 60 * 60 * 1000,
      source: row.source,
      fit,
    };
  });
  // "Best match": the page arrives by closeness to the resume; within it, the full score orders the cards.
  if (filters.sort === "match") jobs.sort((a, b) => Number(b.fit.matches) - Number(a.fit.matches) || (b.fit.score ?? 0) - (a.fit.score ?? 0));
  return { jobs, total, page: at, pages: Math.max(1, Math.ceil(total / BROWSE_PAGE)) };
}
