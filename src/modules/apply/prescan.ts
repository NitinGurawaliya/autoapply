import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { listFeed, parseFeedFilters } from "@/modules/jobs";
import { customQuestionKey, detectConcept, RISKY } from "@/modules/answers";
import type { PendingQuestion } from "./adapter";
import { jobQuestions } from "./questions";
import { resolveForm } from "./resolveForm";

/**
 * "Fill your gaps" (T56): read the questions of the user's top feed jobs from the boards' public APIs (no browser), run
 * the same answering chain on each (essays the run would draft do not count), and keep the facts still missing,
 * ranked by how many jobs each one blocks. Answering the top few means most applications run without asking.
 * Stored in FeedScan (coverage) and FeedGap (one row per missing fact), replaced on every scan.
 */

const SCAN_JOBS = 20;
const PAUSE_MS = 300; // between board API calls, to stay polite to the public API

export async function prescanFeed(userId: string) {
  const feed = (await listFeed(userId, parseFeedFilters({}))).slice(0, SCAN_JOBS);
  return scanJobs(userId, feed.map((job) => job.id));
}

/** Scan these jobs for the user and store the result (prescanFeed passes the top of the feed). */
export async function scanJobs(userId: string, jobIds: string[]) {
  const [profile, answers] = await Promise.all([db.profile.findUnique({ where: { userId } }), db.answer.findMany({ where: { userId } })]);
  if (!profile) return { scanned: 0, covered: 0, gaps: 0 };
  const jobs = await db.job.findMany({ where: { id: { in: jobIds } }, include: { company: { select: { slug: true, name: true } } } });

  let scanned = 0;
  let covered = 0;
  const gaps = new Map<string, { question: PendingQuestion; jobs: number; context: Record<string, string> | null }>();
  for (const job of jobs) {
    const fields = await jobQuestions(job);
    if (job.source !== "mock") await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    if (!fields || fields.length === 0) continue;
    const { missing } = await resolveForm({
      userId,
      source: job.source,
      fields,
      profile,
      answers,
      job: { company: job.company.name, title: job.title, location: job.location, country: job.country, description: job.description },
      draftEssays: false,
    });
    scanned += 1;
    if (missing.length === 0) covered += 1;
    for (const question of missing) {
      // A question about the job's country ("authorized to work in the country where this job is located") is grouped
      // by that country and saved with it, so one answer serves every job there, in any wording (memory, recall.ts).
      const kind = detectConcept(question.label);
      const place = kind && RISKY[kind].parameter === "country" ? placeOf(job) : null;
      const plain = kind && place ? COUNTRY_QUESTIONS[kind]?.(place) : undefined;
      const grouped = plain ? { ...question, label: plain, key: customQuestionKey(plain) } : question;
      const entry = gaps.get(grouped.key);
      if (entry) entry.jobs += 1;
      else gaps.set(grouped.key, { question: grouped, jobs: 1, context: place ? { country: job.country, location: job.location } : null });
    }
  }

  await db.$transaction([
    db.feedGap.deleteMany({ where: { userId } }),
    db.feedGap.createMany({
      data: [...gaps.entries()].map(([key, { question, jobs, context }]) => ({
        userId,
        key,
        label: question.label.slice(0, 1000),
        type: question.type,
        options: question.options ? (question.options as Prisma.InputJsonValue) : Prisma.DbNull,
        context: context ? (context as Prisma.InputJsonValue) : Prisma.DbNull,
        jobs,
      })),
    }),
    db.feedScan.upsert({ where: { userId }, create: { userId, scanned, covered }, update: { scanned, covered } }),
  ]);
  return { scanned, covered, gaps: gaps.size };
}

// One plain wording per kind of country question, naming the country: every form's wording of it, for every job in that
// country, becomes one gap, and the saved answer says which country it is about.
const COUNTRY_QUESTIONS: Partial<Record<string, (place: string) => string>> = {
  work_authorization: (place) => `Are you legally authorized to work in ${place}?`,
  needs_sponsorship: (place) => `Will you now or in the future need visa sponsorship to work in ${place}?`,
  citizenship: (place) => `Are you a citizen or permanent resident of ${place}?`,
};

/** The country a job is in, as words a person reads and the memory can match ("the United States", "London, UK"). */
function placeOf(job: { country: string; location: string }) {
  if (job.country === "US") return "the United States";
  if (job.country === "IN") return "India";
  return job.location.trim() || null;
}
