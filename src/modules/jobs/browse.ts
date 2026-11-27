import { db } from "@/lib/db";
import type { BrowseFilters } from "@/lib/browse-url";
import type { Profile } from "@prisma/client";
import { briefOf } from "@/modules/profile/brief";
import { fitJobs, fitOn } from "./fit";
import { tracksOf } from "./functions";
import { readingGateOn } from "./gate";
import { daysAgo, DEFAULT_PLACES, feedBoardsFor, feedRows, feedTracks, labelledSkills, levelsFor, scoreFeatures, titleWordsFor, yearsReach, type FeedRow } from "./match";
import { profileFit, type ProfileFit } from "./profile-fit";
import { formatSalary } from "./salary";
import { judgeJobs, profileVector, type Judgement } from "./semantic";
import { candidateShows } from "./skills";
import { z } from "zod";

// All jobs (Phase X, docs/feed/TDD.md 4.3): every open job the filters find, a page at a time, each judged against the
// profile with profileFit. Today's picks (listFeed) stay as they are; this list has no 65 floor and no 5-card cap. Every
// row gets the cheap score (closeness, skills, years); the model judges only the page being looked at, so the cost
// follows what is seen, and its verdicts are cached for the feed too. The company page (X4) judges one employer's jobs
// with the same code (employerFits).

export const BROWSE_PAGE = 25;
/** The company page: how many of an employer's jobs the model judges, closest first among those passing the rules. */
const EMPLOYER_JUDGED = 30;

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

/** What every judgement of one person reads once: their profile, vector, boards and the gate switch. */
type Person = Awaited<ReturnType<typeof personOf>> & {};

async function personOf(userId: string) {
  const profile = await db.profile.findUnique({ where: { userId } });
  if (!profile) return null;
  const parsed = skillsSchema.safeParse(profile.skills);
  const [vector, boards] = await Promise.all([profileVector(profile), feedBoardsFor(userId)]);
  return {
    userId,
    profile,
    skills: parsed.success ? parsed.data : [],
    shows: candidateShows(profile),
    tracks: tracksOf(profile),
    years: profile.yearsExperience ?? null,
    vector,
    sources: profile.isTest ? [...new Set([...boards, "mock"])] : boards,
    gateOn: readingGateOn(),
  };
}

/** The model's verdicts for these rows (cached): the fit path when it is on, else the old judge. `cachedOnly`: no model call. */
async function judge(person: Person, rows: FeedRow[], cachedOnly = false): Promise<Map<string, Judgement>> {
  const judgements = new Map<string, Judgement>();
  const real = rows.filter((row) => row.source !== "mock");
  if (real.length === 0) return judgements;
  if (fitOn()) {
    const who = { userId: person.userId, profileId: person.profile.id, brief: briefOf(person.profile as Profile), shows: person.shows, years: person.years };
    for (const [id, verdict] of await fitJobs(who, real.map((row) => row.id), { judge: !cachedOnly, lease: false, lane: "interactive" }).catch(() => new Map())) judgements.set(id, verdict);
  } else {
    const texts = real.map((row) => ({ id: row.id, title: row.title, contentHash: row.contentHash }));
    for (const [id, judgement] of await judgeJobs(person.profile, texts, undefined, { cachedOnly }).catch(() => new Map<string, Judgement>())) judgements.set(id, judgement);
  }
  return judgements;
}

/** Each row's score and profileFit, with the employer's name and mark (Phase W) over the board row's own. */
async function cardsOf(person: Person, rows: FeedRow[], judgements: Map<string, Judgement>, shown: string[] | null): Promise<BrowseCard[]> {
  const { profile, skills, shows, tracks, years, gateOn } = person;
  // Workday's board row is named for the tenant ("acme.wd5/External"); the employer has the real name.
  const employerIds = [...new Set(rows.map((row) => row.employerId).filter((id): id is string => id != null))];
  const employers = new Map(
    (employerIds.length > 0 ? await db.employer.findMany({ where: { id: { in: employerIds } }, select: { id: true, slug: true, name: true, logoUrl: true } }) : []).map((employer) => [employer.id, employer]),
  );
  const who = { tracks, showNearby: profile.showNearby, avoid: profile.avoid ?? [], yearsExperience: years, shows };
  return rows.map((row): BrowseCard => {
    const hits = new Set(row.hits);
    const judgement = judgements.get(row.id) ?? null;
    const gateJob = { source: row.source, title: row.title, track: row.track, roleFamily: row.roleFamily, kind: row.kind, flags: row.flags, readingCurrent: row.readingCurrent, seniority: row.seniority };
    // The score with the field part off: a job outside the person's fields keeps an honest number, and profileFit
    // names the field as the reason it does not match.
    const match = scoreFeatures(
      { title: row.title, track: row.track, seniority: row.seniority, similarity: row.similarity, judgement, country: row.country, remoteType: row.remoteType, requiredYears: row.experienceMin, skillHits: skills.filter((_, index) => hits.has(index)), jobSkills: labelledSkills(row) },
      { currentTitle: profile.currentTitle, skills, yearsExperience: years, preferredLocations: [], tracks: [...new Set([...tracks, ...(shown ?? [])])], shows },
      gateOn ? { job: gateJob, tracks: null, avoid: profile.avoid ?? [], field: false } : undefined,
    );
    const fit = profileFit(
      { ...gateJob, experienceMin: row.experienceMin, skills: row.skills, skillsRequired: labelledSkills(row).required },
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
}

export async function browseJobs(userId: string, filters: BrowseFilters, page = 1): Promise<BrowsePage> {
  const person = await personOf(userId);
  if (!person) return { jobs: [], total: 0, page: 1, pages: 1 };
  const { profile, years, gateOn } = person;
  const own = feedTracks(person.tracks, profile.showNearby === true);
  const shown = filters.field === "profile" ? own : filters.field === "all" ? null : [filters.field];
  const at = Math.max(1, Math.floor(page) || 1);
  const rows = await feedRows({
    userId,
    sources: person.sources,
    countries: filters.countries,
    levelYears: null,
    // The person's own band until they widen the years; a number widens to it.
    band: filters.exp === "profile" ? { maxYears: yearsReach(years), levels: levelsFor(years) } : null,
    stages: filters.stages.length > 0 ? filters.stages : null,
    tracks: shown,
    vector: person.vector,
    cutoff: new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000),
    expMax: typeof filters.exp === "number" ? filters.exp : null,
    skills: person.skills,
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
  const jobs = await cardsOf(person, rows, await judge(person, rows), shown);
  // "Best match": the page arrives by closeness to the resume; within it, the full score orders the cards.
  if (filters.sort === "match") jobs.sort((a, b) => Number(b.fit.matches) - Number(a.fit.matches) || (b.fit.score ?? 0) - (a.fit.score ?? 0));
  return { jobs, total, page: at, pages: Math.max(1, Math.ceil(total / BROWSE_PAGE)) };
}

/**
 * The company page, signed in (X4, docs/feed/TDD.md 4.4): profileFit for each of one employer's open jobs in India and
 * remote India on the boards the agent applies on, swiped left or not (never the ones applied to). No field, years or
 * gate filter in SQL, so every job gets its reason from profileFit. The model judges the closest EMPLOYER_JUDGED that
 * pass the rules; the rest keep the cheap score (`cachedOnly`: verdicts already cached only, no model call, for a count on
 * a page that must stay cheap). Empty for a person with no profile.
 */
export async function employerFits(userId: string, employerId: string, options: { cachedOnly?: boolean } = {}): Promise<Map<string, ProfileFit>> {
  const person = await personOf(userId);
  if (!person) return new Map();
  const rows = await feedRows({
    userId,
    sources: person.sources,
    countries: [...DEFAULT_PLACES],
    levelYears: null,
    band: null,
    stages: null,
    tracks: null,
    vector: person.vector,
    cutoff: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    expMax: null,
    skills: person.skills,
    titleWords: titleWordsFor(person.profile.currentTitle),
    prefilter: false,
    readingGate: false,
    avoid: [],
    minSimilarity: 0,
    includeSkipped: true,
    employerId,
    page: { order: "match", limit: 500, offset: 0 },
  });
  const unjudged = await cardsOf(person, rows, new Map(), null);
  const passing = new Set(unjudged.filter((card) => !card.fit.hard).slice(0, EMPLOYER_JUDGED).map((card) => card.id));
  const cards = passing.size > 0 ? await cardsOf(person, rows, await judge(person, rows.filter((row) => passing.has(row.id)), options.cachedOnly), null) : unjudged;
  return new Map(cards.map((card) => [card.id, card.fit]));
}
