import { z } from "zod";
import { db } from "@/lib/db";
import { callJson } from "@/lib/llm";
import { BOARDS as ALL_BOARDS, type BoardDiscovery, type BoardSource } from "./boards";
import { fetchLogoUrl } from "./logos";

/**
 * Discovery that runs by itself (T89): every day the worker finds companies that are not on our list yet, checks each
 * one's public job board, and adds the ones that hire in India now. One run covers every board in BOARDS, Greenhouse
 * then Ashby (owner, 15 Oct: Ashby had 81 India jobs from 14 companies against Greenhouse's 797), with the same rule. It also checks again the companies on
 * Greenhouse that had too few India jobs (every RECHECK_DAYS). New names come from the model (a few dozen a day,
 * a different sector each day, never one already checked: DiscoveryCandidate keeps every name ever checked), and each
 * name is verified against Greenhouse's public boards API, so a name the model invents costs one request and nothing
 * else. Rule (owner, 11 Oct): on Greenhouse, at least MIN_INDIA_JOBS open India or remote-from-India jobs, at least one
 * posted in the last 30 days. Added companies are fetched by the next ingest. Polite: 4 boards at a time, 300 ms apart.
 */

// How each board is checked, and its bar (MIN_INDIA_JOBS on Greenhouse), live with the board: boards.ts `discovery`.
const FRESH_DAYS = 30;
const PER_RUN = 40;
// Companies on Greenhouse that had too few India jobs are checked again after RECHECK_DAYS (they start hiring in India
// over time); up to RECHECK_PER_RUN a day. The model alone knows few new names by now (0-2 a day, 11 Oct).
const RECHECK_DAYS = 14;
const RECHECK_PER_RUN = 60;
export const CONCURRENCY = 4;

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

/** A board discovery runs on: the registry entry's name and slug rule with its discovery settings. */
export type Board = BoardDiscovery & { source: BoardSource; label: string; slugOf: (text: string) => string };

/** The boards discovery covers, in order (Greenhouse, then Ashby). */
export const BOARDS: Board[] = ALL_BOARDS.flatMap((board) => (board.discovery ? [{ source: board.source, label: board.label, slugOf: board.slugOf, ...board.discovery }] : []));

/**
 * Names for today's run from the model, minus every name already checked or on our list. The model is given every
 * name already checked to avoid (it otherwise keeps proposing the same famous companies: 19 of 20 already checked, 11 Oct)
 * and asked for less obvious ones, sector by sector, until `count` new names come up or MAX_CALLS calls are made.
 */
const MAX_CALLS = 3;
// 50 a call ran past the model's output limit and came back cut off (15 Oct, Ashby): no names at all.
const NAMES_PER_CALL = 25;
/** Which companies the model is asked for: the daily run looks past household names; a "large" run asks for them. */
export type DiscoveryFocus = "broad" | "large";
const FOCUS_TEXT: Record<DiscoveryFocus, string> = {
  broad: "Go beyond the obvious household names: mid-size companies, well-funded startups, and global software companies with smaller Indian teams are what we need.",
  large: "Large, established employers only: global software and internet companies, public companies, unicorns and late-stage companies with a sizeable engineering team in India (hundreds of employees or more there).",
};

export async function proposeCandidates(known: { keys: Set<string>; names: string[] }, count = PER_RUN, day = new Date(), board: Board = BOARDS[0], focus: DiscoveryFocus = "broad") {
  const index = Math.floor(day.getTime() / (24 * 60 * 60 * 1000));
  const out: Array<{ name: string; stage: string | null; slugs: string[] }> = [];
  for (let call = 0; call < MAX_CALLS && out.length < count; call += 1) {
    const sector = SECTORS[(index + call * 5) % SECTORS.length];
    const result = await callJson(
      proposalSchema,
      `You help find employers for job seekers in India. List real companies that hire software, data, security or other tech roles in India (an office in India, or remote roles open to India) and that likely use ${board.label} as their applicant tracking system (job board at ${board.boardUrl}). ${FOCUS_TEXT[focus]} Never list a company in "avoid" (already checked). For each: name, stage (startup | midsize | mnc) and up to 3 likely ${board.label} board slugs (lowercase, e.g. the company name without spaces). Return {"companies":[{"name","stage","slugs"}]} with ${NAMES_PER_CALL} companies.`,
      JSON.stringify({ sector, avoid: [...known.names, ...out.map((item) => item.name)] }),
    );
    for (const company of result.companies) {
      const key = normalName(company.name);
      if (!key || known.keys.has(key) || out.some((item) => normalName(item.name) === key)) continue;
      const slugs = [...new Set([...(company.slugs ?? []).map(board.slugOf), key])].filter((slug) => slug.length >= 2);
      out.push({ name: company.name.trim(), stage: company.stage ?? null, slugs });
    }
  }
  return out.slice(0, count);
}

/** The first of these slugs that is a live board, with its open jobs, or null. */
async function findBoard(slugs: string[], board: Board) {
  for (const slug of slugs) {
    const jobs = await board.open(slug);
    if (jobs) return { slug, jobs };
  }
  return null;
}

/** One candidate: is it on this board, and how many India jobs (and recent ones) does it have open. */
export async function checkCandidate(candidate: { slugs: string[] }, board: Board = BOARDS[0]) {
  const found = await findBoard(candidate.slugs, board);
  if (!found) return { slug: null, openJobs: 0, indiaJobs: 0, freshIndiaJobs: 0 };
  const { slug, jobs } = found;
  const cutoff = Date.now() - FRESH_DAYS * 24 * 60 * 60 * 1000;
  let indiaJobs = 0;
  let freshIndiaJobs = 0;
  for (const job of jobs) {
    if (!board.counts(job)) continue;
    indiaJobs += 1;
    if (job.postedAt.getTime() >= cutoff) freshIndiaJobs += 1;
  }
  return { slug, openJobs: jobs.length, indiaJobs, freshIndiaJobs };
}

// Board names the model does not know: every public board page of the host in the latest Common Crawl indexes (a
// public archive of the web; only the index is read, never the boards' pages). 15 Oct: two crawls listed 1,370 Ashby
// boards, against 43 we had; Greenhouse and Lever since T92. At most CRAWL_PER_RUN new ones are checked a run; every one checked is recorded.
const CRAWLS = 6;
const CRAWL_PER_RUN = 400;
const NOT_A_BOARD = new Set(["api", "embed", "static", "assets", "favicon.ico", "robots.txt"]);

/**
 * `host` "*.myworkdayjobs.com" reads every subdomain (Workday, Zoho Recruit: the company is the host); `slugFromUrl`
 * reads the slug from such an address, and `maxPages` caps the index pages read a crawl for hosts with millions of pages.
 */
export async function slugsFromCrawl(host: string, crawls = CRAWLS, log: (line: string) => void = () => undefined, options: { slugFromUrl?: (url: URL) => string | null; maxPages?: number } = {}) {
  const slugs = new Set<string>();
  const info = (await (await fetch("https://index.commoncrawl.org/collinfo.json", { signal: AbortSignal.timeout(30000) })).json()) as Array<{ id: string }>;
  for (const { id } of info.slice(0, crawls)) {
    const base = `https://index.commoncrawl.org/${id}-index?url=${host.startsWith("*.") ? host : `${host}/*`}&output=json&fl=url`;
    let meta: { pages?: number } | null = null;
    for (let attempt = 0; attempt < 4 && !meta; attempt += 1) {
      if (attempt > 0) await pause(5000 * 2 ** attempt);
      meta = (await fetch(`${base}&showNumPages=true`, { signal: AbortSignal.timeout(60000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { pages?: number } | null;
    }
    // A busy index (503) used to read as an empty crawl: 24 Oct, Lever 284 boards one run and 27 the next, Ashby 0.
    if (!meta) log(`discovery: ${id} ${host}: the index did not say how many pages it has; this crawl was skipped`);
    const pages = Math.min(meta?.pages ?? 0, options.maxPages ?? Infinity);
    let unread = 0;
    for (let page = 0; page < pages; page += 1) {
      // The index is often busy (503): a page is tried up to 4 times, waiting longer each time, before it counts as empty.
      let text = "";
      for (let attempt = 0; attempt < 4 && !text; attempt += 1) {
        if (attempt > 0) await pause(5000 * 2 ** attempt);
        text = await fetch(`${base}&page=${page}`, { signal: AbortSignal.timeout(120000) }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
      }
      if (!text) unread += 1;
      for (const line of text.split("\n")) {
        try {
          if (options.slugFromUrl) {
            const slug = options.slugFromUrl(new URL((JSON.parse(line) as { url: string }).url));
            if (slug) slugs.add(slug);
            continue;
          }
          const slug = decodeURIComponent(new URL((JSON.parse(line) as { url: string }).url).pathname.split("/")[1] ?? "").toLowerCase();
          if (slug && !NOT_A_BOARD.has(slug) && /^[a-z0-9][a-z0-9.-]*$/.test(slug)) slugs.add(slug);
        } catch {
          // a line that is not a record
        }
      }
      await pause(1000);
    }
    log(`discovery: ${id} → ${slugs.size} ${host} boards so far${unread > 0 ? ` (${unread} of ${pages} index pages could not be read)` : ""}`);
  }
  return [...slugs];
}

type Totals = { proposed: number; rechecked: number; onBoard: number; added: number; indiaJobsAdded: number; errors: number };

/** Today's discovery on every board (BOARDS), one after the other. */
export async function runDiscovery(options: { count?: number; crawlLimit?: number; boards?: string[]; focus?: DiscoveryFocus; log?: (line: string) => void } = {}) {
  const totals: Record<string, Totals> = {};
  for (const board of BOARDS.filter((item) => !options.boards || options.boards.includes(item.source))) totals[board.source] = await discoverOn(board, options);
  return totals;
}

/**
 * Saves one checked board: a DiscoveryCandidate row (so it is never checked as new again) and, when it passes the
 * board's rule, the Company that the ingest then reads. Used by the daily run and by scripts/discover-boards.ts.
 */
export async function recordChecked(
  board: Board,
  candidate: { name: string; stage: string | null; from: string },
  result: Awaited<ReturnType<typeof checkCandidate>>,
  log: (line: string) => void = () => undefined,
) {
  const source = board.source;
  let status = "not_on_board";
  if (result.slug) {
    status = result.indiaJobs >= board.minIndiaJobs && (!board.needsFresh || result.freshIndiaJobs >= 1) ? "added" : "few_india_jobs";
    if (status === "added") {
      await db.company.upsert({
        where: { source_slug: { source, slug: result.slug } },
        create: { source, slug: result.slug, name: ((candidate.from === "crawl" || candidate.from === "import") && (await board.nameOf?.(result.slug))) || candidate.name, stage: candidate.stage, addedBy: "discovery" },
        update: {},
      });
      // Its logo for the cards, from the same public board page (logos.ts); a miss is looked at again later.
      const logoUrl = await fetchLogoUrl(source, result.slug).catch(() => null);
      await db.$executeRaw`UPDATE "Company" SET "logoUrl" = ${logoUrl}, "logoCheckedAt" = now() WHERE source = ${source} AND slug = ${result.slug} AND "logoUrl" IS NULL`;
      log(`discovery ${source}: added ${candidate.name} (${result.slug}): ${result.indiaJobs} India jobs, ${result.freshIndiaJobs} in the last ${FRESH_DAYS} days`);
    }
  }
  await db.discoveryCandidate.upsert({
    where: { source_name: { source, name: candidate.name } },
    create: { source, name: candidate.name, slug: result.slug, stage: candidate.stage, from: candidate.from, status, openJobs: result.openJobs, indiaJobs: result.indiaJobs, freshIndiaJobs: result.freshIndiaJobs },
    update: { slug: result.slug, status, openJobs: result.openJobs, indiaJobs: result.indiaJobs, freshIndiaJobs: result.freshIndiaJobs, checkedAt: new Date() },
  });
  return status;
}

/** One board: propose, check, record every name, add the ones that pass the rule. */
async function discoverOn(board: Board, options: { count?: number; crawlLimit?: number; focus?: DiscoveryFocus; log?: (line: string) => void }) {
  const log = options.log ?? ((line: string) => console.log(line));
  const source = board.source;
  const [checked, companies, everywhere] = await Promise.all([
    db.discoveryCandidate.findMany({ where: { source }, select: { name: true, slug: true } }),
    db.company.findMany({ where: { source }, select: { name: true, slug: true } }),
    // A company we already take from another board is not proposed again: its jobs would come in twice.
    db.company.findMany({ select: { name: true } }),
  ]);
  const names = [...new Set([...checked.map((row) => row.name), ...everywhere.map((row) => row.name)])];
  const known = { keys: new Set(names.map(normalName)), names };
  const knownSlugs = new Set([...checked.map((row) => row.slug), ...companies.map((row) => row.slug)].filter((slug): slug is string => !!slug));
  const proposals = await (board.fromModel === false ? Promise.resolve([]) : proposeCandidates(known, options.count ?? PER_RUN, new Date(), board, options.focus)).catch((error) => {
    log(`discovery ${source}: the model gave no names (${error instanceof Error ? error.message.slice(0, 80) : "failed"})`);
    return [] as Awaited<ReturnType<typeof proposeCandidates>>;
  });
  const due = await db.discoveryCandidate.findMany({
    where: { source, status: "few_india_jobs", slug: { not: null }, checkedAt: { lt: new Date(Date.now() - RECHECK_DAYS * 24 * 60 * 60 * 1000) } },
    orderBy: { checkedAt: "asc" },
    take: RECHECK_PER_RUN,
    select: { name: true, slug: true, stage: true },
  });
  const rechecks = due.filter((row) => !companies.some((company) => company.slug === row.slug)).map((row) => ({ name: row.name, stage: row.stage, slugs: [row.slug!], recheck: true }));
  // Every host of the board (Greenhouse has two), each slug written the board's way and listed once.
  const fromCrawl: string[] = [];
  // A crawl limit of 0 (scripts/discover-now.ts --no-crawl) skips the index download too: it can take many minutes.
  for (const host of options.crawlLimit === 0 ? [] : (board.crawlHosts ?? [])) {
    const slugs = await slugsFromCrawl(host, CRAWLS, log, { slugFromUrl: board.slugFromUrl, maxPages: board.crawlPages }).catch((error) => {
      log(`discovery ${source}: the crawl index gave no boards for ${host} (${error instanceof Error ? error.message.slice(0, 80) : "failed"})`);
      return [] as string[];
    });
    fromCrawl.push(...slugs.map(board.slugOf).filter((slug) => slug.length >= 2));
  }
  const crawled = [...new Set(fromCrawl)]
    .filter((slug) => !knownSlugs.has(slug) && !known.keys.has(normalName(slug)) && !proposals.some((item) => item.slugs.includes(slug)))
    .slice(0, options.crawlLimit ?? CRAWL_PER_RUN)
    .map((slug) => ({ name: slug, stage: null, slugs: [slug], recheck: false, from: "crawl" }));
  const queue = [...proposals.map((item) => ({ ...item, recheck: false, from: "model" })), ...rechecks.map((item) => ({ ...item, from: "list" })), ...crawled];
  const totals: Totals = { proposed: proposals.length + crawled.length, rechecked: rechecks.length, onBoard: 0, added: 0, indiaJobsAdded: 0, errors: 0 };
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const candidate = queue[next++];
      try {
        const result = await checkCandidate({ slugs: candidate.recheck ? candidate.slugs : candidate.slugs.filter((slug) => !knownSlugs.has(slug)) }, board);
        const status = await recordChecked(board, candidate, result, log);
        if (result.slug) {
          totals.onBoard += 1;
          knownSlugs.add(result.slug);
        }
        if (status === "added") {
          totals.added += 1;
          totals.indiaJobsAdded += result.indiaJobs;
        }
      } catch (error) {
        totals.errors += 1;
        await db.discoveryCandidate
          .upsert({ where: { source_name: { source, name: candidate.name } }, create: { source, name: candidate.name, stage: candidate.stage, from: candidate.from, status: "error" }, update: { checkedAt: new Date() } })
          .catch(() => undefined);
        log(`discovery ${source}: ${candidate.name}: ${error instanceof Error ? error.message.slice(0, 80) : "failed"}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`discovery ${source} done: ${JSON.stringify(totals)}`);
  return totals;
}
