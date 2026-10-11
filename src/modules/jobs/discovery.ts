import { z } from "zod";
import { db } from "@/lib/db";
import { callJson } from "@/lib/llm";
import { fetchGreenhouse } from "./fetchers/greenhouse";
import { tagPosting } from "./tagging";

/**
 * Discovery that runs by itself (T89): every day the worker finds companies that are not on our list yet, checks each
 * one's public Greenhouse board, and adds the ones that hire in India now. It also checks again the companies on
 * Greenhouse that had too few India jobs (every RECHECK_DAYS). New names come from the model (a few dozen a day,
 * a different sector each day, never one already checked: DiscoveryCandidate keeps every name ever checked), and each
 * name is verified against Greenhouse's public boards API, so a name the model invents costs one request and nothing
 * else. Rule (owner, 11 Oct): on Greenhouse, at least MIN_INDIA_JOBS open India or remote-from-India jobs, at least one
 * posted in the last 30 days. Added companies are fetched by the next ingest. Polite: 4 boards at a time, 300 ms apart.
 */

export const MIN_INDIA_JOBS = 3;
const FRESH_DAYS = 30;
const PER_RUN = 40;
// Companies on Greenhouse that had too few India jobs are checked again after RECHECK_DAYS (they start hiring in India
// over time); up to RECHECK_PER_RUN a day. The model alone knows few new names by now (0-2 a day, 11 Oct).
const RECHECK_DAYS = 14;
const RECHECK_PER_RUN = 60;
const CONCURRENCY = 4;
const PAUSE_MS = 300;

// A different focus each day, so the model does not keep proposing the same famous names.
const SECTORS = [
  "fintech, payments, banking software and insurance technology",
  "developer tools, cloud infrastructure, databases and DevOps",
  "cybersecurity and identity",
  "AI, machine learning and data platforms",
  "B2B SaaS: sales, marketing, HR, finance and productivity software",
  "e-commerce, marketplaces, logistics and supply chain technology",
  "consumer apps, media, gaming and social",
  "health technology, biotech software and education technology",
  "enterprise software, IT services with product teams, and semiconductors",
  "travel, mobility, real estate and climate technology",
  "Indian startups and unicorns (any sector)",
  "global companies with engineering centres in Bengaluru, Hyderabad, Pune, Chennai, Gurugram or Noida",
];

const proposalSchema = z.object({
  companies: z.array(z.object({ name: z.string().min(1).max(120), stage: z.enum(["startup", "midsize", "mnc"]).nullable().optional(), slugs: z.array(z.string()).max(4).optional() })),
});

export const normalName = (name: string) => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Names for today's run from the model, minus every name already checked or on our list. The model is given every
 * name already checked to avoid (it otherwise keeps proposing the same famous companies: 19 of 20 already checked, 11 Oct)
 * and asked for less obvious ones, sector by sector, until `count` new names come up or MAX_CALLS calls are made.
 */
const MAX_CALLS = 3;
export async function proposeCandidates(known: { keys: Set<string>; names: string[] }, count = PER_RUN, day = new Date()) {
  const index = Math.floor(day.getTime() / (24 * 60 * 60 * 1000));
  const out: Array<{ name: string; stage: string | null; slugs: string[] }> = [];
  for (let call = 0; call < MAX_CALLS && out.length < count; call += 1) {
    const sector = SECTORS[(index + call * 5) % SECTORS.length];
    const result = await callJson(
      proposalSchema,
      `You help find employers for job seekers in India. List real companies that hire software, data, security or other tech roles in India (an office in India, or remote roles open to India) and that likely use Greenhouse as their applicant tracking system (job board at boards.greenhouse.io/<slug>). Go beyond the obvious household names: mid-size companies, well-funded startups, and global software companies with smaller Indian teams are what we need. Never list a company in "avoid" (already checked). For each: name, stage (startup | midsize | mnc) and up to 3 likely Greenhouse board slugs (lowercase, letters and digits only, e.g. the company name without spaces). Return {"companies":[{"name","stage","slugs"}]} with ${50} companies.`,
      JSON.stringify({ sector, avoid: [...known.names, ...out.map((item) => item.name)] }),
    );
    for (const company of result.companies) {
      const key = normalName(company.name);
      if (!key || known.keys.has(key) || out.some((item) => normalName(item.name) === key)) continue;
      const slugs = [...new Set([...(company.slugs ?? []).map((slug) => slug.toLowerCase().replace(/[^a-z0-9]/g, "")), key])].filter((slug) => slug.length >= 2);
      out.push({ name: company.name.trim(), stage: company.stage ?? null, slugs });
    }
  }
  return out.slice(0, count);
}

/** The first of these slugs that is a live Greenhouse board, or null. */
async function findBoard(slugs: string[]) {
  for (const slug of slugs) {
    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    await pause(PAUSE_MS);
    if (response?.ok) return slug;
  }
  return null;
}

/** One candidate: is it on Greenhouse, and how many India jobs (and recent ones) does it have open. */
export async function checkCandidate(candidate: { slugs: string[] }) {
  const slug = await findBoard(candidate.slugs);
  if (!slug) return { slug: null, openJobs: 0, indiaJobs: 0, freshIndiaJobs: 0 };
  const jobs = await fetchGreenhouse(slug);
  const cutoff = Date.now() - FRESH_DAYS * 24 * 60 * 60 * 1000;
  let indiaJobs = 0;
  let freshIndiaJobs = 0;
  for (const job of jobs) {
    const { eligibility } = tagPosting(job);
    if (eligibility !== "india" && eligibility !== "remote_india") continue;
    indiaJobs += 1;
    if (job.postedAt.getTime() >= cutoff) freshIndiaJobs += 1;
  }
  return { slug, openJobs: jobs.length, indiaJobs, freshIndiaJobs };
}

/** Today's discovery: propose, check, record every name, add the ones that pass the rule. */
export async function runDiscovery(options: { count?: number; log?: (line: string) => void } = {}) {
  const log = options.log ?? ((line: string) => console.log(line));
  const [checked, companies] = await Promise.all([
    db.discoveryCandidate.findMany({ where: { source: "greenhouse" }, select: { name: true, slug: true } }),
    db.company.findMany({ where: { source: "greenhouse" }, select: { name: true, slug: true } }),
  ]);
  const names = [...new Set([...checked.map((row) => row.name), ...companies.map((row) => row.name)])];
  const known = { keys: new Set(names.map(normalName)), names };
  const knownSlugs = new Set([...checked.map((row) => row.slug), ...companies.map((row) => row.slug)].filter((slug): slug is string => !!slug));
  const proposals = await proposeCandidates(known, options.count ?? PER_RUN).catch((error) => {
    log(`discovery: the model gave no names (${error instanceof Error ? error.message.slice(0, 80) : "failed"})`);
    return [] as Awaited<ReturnType<typeof proposeCandidates>>;
  });
  const due = await db.discoveryCandidate.findMany({
    where: { source: "greenhouse", status: "few_india_jobs", slug: { not: null }, checkedAt: { lt: new Date(Date.now() - RECHECK_DAYS * 24 * 60 * 60 * 1000) } },
    orderBy: { checkedAt: "asc" },
    take: RECHECK_PER_RUN,
    select: { name: true, slug: true, stage: true },
  });
  const rechecks = due.filter((row) => !companies.some((company) => company.slug === row.slug)).map((row) => ({ name: row.name, stage: row.stage, slugs: [row.slug!], recheck: true }));
  const queue = [...proposals.map((item) => ({ ...item, recheck: false })), ...rechecks];
  const totals = { proposed: proposals.length, rechecked: rechecks.length, onBoard: 0, added: 0, indiaJobsAdded: 0, errors: 0 };
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const candidate = queue[next++];
      try {
        const result = await checkCandidate({ slugs: candidate.recheck ? candidate.slugs : candidate.slugs.filter((slug) => !knownSlugs.has(slug)) });
        let status = "not_on_board";
        if (result.slug) {
          totals.onBoard += 1;
          knownSlugs.add(result.slug);
          status = result.indiaJobs >= MIN_INDIA_JOBS && result.freshIndiaJobs >= 1 ? "added" : "few_india_jobs";
          if (status === "added") {
            await db.company.upsert({
              where: { source_slug: { source: "greenhouse", slug: result.slug } },
              create: { source: "greenhouse", slug: result.slug, name: candidate.name, stage: candidate.stage, addedBy: "discovery" },
              update: {},
            });
            totals.added += 1;
            totals.indiaJobsAdded += result.indiaJobs;
            log(`discovery: added ${candidate.name} (${result.slug}): ${result.indiaJobs} India jobs, ${result.freshIndiaJobs} in the last ${FRESH_DAYS} days`);
          }
        }
        await db.discoveryCandidate.upsert({
          where: { source_name: { source: "greenhouse", name: candidate.name } },
          create: { name: candidate.name, slug: result.slug, stage: candidate.stage, from: candidate.recheck ? "list" : "model", status, openJobs: result.openJobs, indiaJobs: result.indiaJobs, freshIndiaJobs: result.freshIndiaJobs },
          update: { slug: result.slug, status, openJobs: result.openJobs, indiaJobs: result.indiaJobs, freshIndiaJobs: result.freshIndiaJobs, checkedAt: new Date() },
        });
      } catch (error) {
        totals.errors += 1;
        await db.discoveryCandidate
          .upsert({ where: { source_name: { source: "greenhouse", name: candidate.name } }, create: { name: candidate.name, stage: candidate.stage, from: candidate.recheck ? "list" : "model", status: "error" }, update: { checkedAt: new Date() } })
          .catch(() => undefined);
        log(`discovery: ${candidate.name}: ${error instanceof Error ? error.message.slice(0, 80) : "failed"}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`discovery done: ${JSON.stringify(totals)}`);
  return totals;
}
