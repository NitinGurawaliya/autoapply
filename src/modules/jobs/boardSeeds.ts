import { db } from "@/lib/db";
import type { BoardSource } from "./boards";
import { BOARDS, checkCandidate, CONCURRENCY, normalName, recordChecked, slugsFromCrawl, type Board } from "./discovery";

// Board seeds from free sources only (24 Oct): the Common Crawl index and URL lists collected by hand. Each seed is a
// board identifier on one ATS; it is deduplicated, its public job feed is checked, and (only with `write`) the result is
// recorded through the same path as the daily discovery, so a board is never checked as new twice.

// Every board with discovery (M3: Workday, Keka and Zoho Recruit too, by their hosts).
export type SeedSource = BoardSource;
export const SEED_SOURCES: SeedSource[] = BOARDS.map((board) => board.source);

const NOT_A_BOARD = new Set(["api", "embed", "static", "assets", "favicon.ico", "robots.txt", "v1", "jobs", "careers"]);
const SLUG = /^[a-z0-9][a-z0-9.-]*$/;

/** The ATS and board identifier in a job board address, or null when it is not one of ours. */
export function boardFromUrl(text: string): { source: SeedSource; slug: string } | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text.trim()) ? text.trim() : `https://${text.trim()}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part).toLowerCase());
  let source: SeedSource | null = null;
  let slug = "";
  if (/^(job-boards|boards)(\.eu)?\.greenhouse\.io$/.test(host)) {
    source = "greenhouse";
    // The embed address names the board in "for": boards.greenhouse.io/embed/job_board?for=acme
    slug = parts[0] === "embed" ? (url.searchParams.get("for") ?? "").toLowerCase() : (parts[0] ?? "");
  } else if (/^jobs(\.eu)?\.lever\.co$/.test(host)) {
    source = "lever";
    slug = parts[0] ?? "";
  } else if (host === "jobs.ashbyhq.com") {
    source = "ashby";
    slug = parts[0] ?? "";
  } else {
    // Boards known by their host (Workday, Keka, Zoho Recruit): each board's own reading of an address (boards.ts).
    for (const board of BOARDS) {
      const found = board.slugFromUrl?.(url);
      if (found) return { source: board.source, slug: found };
    }
  }
  if (!source || !slug || NOT_A_BOARD.has(slug) || !SLUG.test(slug)) return null;
  const board = BOARDS.find((item) => item.source === source);
  const normal = board ? board.slugOf(slug) : slug;
  return normal.length >= 2 ? { source, slug: normal } : null;
}

/**
 * Board identifiers in a hand-made list (a CSV or text file): every URL in it, wherever it sits on the line. A line that
 * is only a bare identifier counts for `bareFor` when given (one ATS at a time).
 */
export function seedsFromText(text: string, bareFor?: SeedSource) {
  const seeds: Array<{ source: SeedSource; slug: string }> = [];
  let urls = 0;
  for (const line of text.split(/\r?\n/)) {
    const found = line.match(/(?:https?:\/\/)?(?:www\.)?(?:job-boards(?:\.eu)?|boards(?:\.eu)?)\.greenhouse\.io\/[^\s,;"'<>)]+|(?:https?:\/\/)?jobs(?:\.eu)?\.lever\.co\/[^\s,;"'<>)]+|(?:https?:\/\/)?jobs\.ashbyhq\.com\/[^\s,;"'<>)]+|https?:\/\/[a-z0-9-]+\.(?:wd\d{1,3}\.myworkdayjobs\.com|keka\.com|zohorecruit\.(?:in|com|eu|com\.au|jp))[^\s,;"'<>)]*|(?:https?:\/\/)?(?:jobs|careers)\.smartrecruiters\.com\/[^\s,;"'<>)]+|(?:https?:\/\/)?apply\.workable\.com\/[^\s,;"'<>)]+|https?:\/\/[a-z0-9-]+\.workable\.com[^\s,;"'<>)]*/gi) ?? [];
    urls += found.length;
    for (const address of found) {
      const seed = boardFromUrl(address);
      if (seed) seeds.push(seed);
    }
    // upstreamit's Workday lists: "tenant|wdN|site".
    const piped = line.trim().match(/^([a-z0-9-]+)\|(wd\d{1,3})\|([A-Za-z0-9_-]+)$/i);
    if (found.length === 0 && piped && (!bareFor || bareFor === "workday")) {
      seeds.push({ source: "workday", slug: `${piped[1].toLowerCase()}.${piped[2].toLowerCase()}/${piped[3]}` });
      continue;
    }
    const bare = line.trim().toLowerCase();
    if (found.length === 0 && bareFor && SLUG.test(bare)) {
      // Written the board's way, as an address would be ("beta-co" is "betaco" on Greenhouse).
      const slug = BOARDS.find((item) => item.source === bareFor)?.slugOf(bare) ?? bare;
      if (slug.length >= 2) seeds.push({ source: bareFor, slug });
    }
  }
  return { urls, seeds };
}

/** Every board identifier the Common Crawl index lists for one ATS's hosts (reads the index only). */
export async function seedsFromCrawl(source: SeedSource, crawls: number, log: (line: string) => void) {
  const board = boardOf(source);
  const slugs: string[] = [];
  for (const host of board.crawlHosts ?? []) slugs.push(...(await slugsFromCrawl(host, crawls, log, { slugFromUrl: board.slugFromUrl, maxPages: board.crawlPages })));
  return slugs.map((slug) => board.slugOf(slug)).filter((slug) => slug.length >= 2);
}

function boardOf(source: SeedSource): Board {
  const board = BOARDS.find((item) => item.source === source);
  if (!board) throw new Error(`No discovery for ${source}`);
  return board;
}

export type SeedYield = {
  source: SeedSource;
  /** Identifiers handed in (URLs read, or crawl entries), before any deduplication. */
  seen: number;
  unique: number;
  /** Already a company or already checked before: skipped. */
  known: number;
  /** New ones left after this batch. */
  remaining: number;
  checked: number;
  /** A live public board answered. */
  valid: number;
  notOnBoard: number;
  failed: number;
  openJobs: number;
  indiaJobs: number;
  /** Pass the board's rule (enough fresh India jobs): added, or would be in a dry run. */
  passing: number;
  added: number;
  /** Times the run paused because the board pushed back, and whether it gave up on the board (auto-pause, M3). */
  paused: number;
  stopped: boolean;
  examples: string[];
};

/** Which of `count` shards a slug belongs to (FNV-1a of the lower-cased slug): parallel runs never share a board. */
export function shardOf(slug: string, count: number) {
  let hash = 0x811c9dc5;
  for (const char of slug.toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % count;
}

// Auto-pause (M3, owner 17 Nov): more than a third of the last 50 checks failing means the board is pushing back (a
// rate limit, an outage), so this run waits, then tries again; three pauses in a row and it stops the board.
const PAUSE_WINDOW = 50;
const PAUSE_MIN_SEEN = 30;
const PAUSE_SHARE = 1 / 3;
const MAX_PAUSES = 3;

/** An error's last line: Prisma's messages start with a line break and a header, which logged as nothing. */
const lastLine = (error: unknown) =>
  error instanceof Error ? (error.message.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? "failed").slice(0, 160) : "failed";

/**
 * Checks up to `limit` new board identifiers of one ATS, at the daily run's pace. A dry run only reads the boards'
 * public feeds; `write` records every checked board (DiscoveryCandidate, `from`) and adds the passing companies.
 */
export async function verifySeeds(
  source: SeedSource,
  slugs: string[],
  options: {
    limit: number;
    write: boolean;
    from: string;
    recheck?: boolean;
    watchAll?: boolean;
    log?: (line: string) => void;
    /** Only the slugs of this shard (`index` of `count`), so several runs can share one board without overlap. */
    shard?: { index: number; count: number };
    /** How long an auto-pause lasts (default 10 minutes). */
    pauseMinutes?: number;
    /** Parallel checks in this run (default CONCURRENCY): 1 for a board that rate-limits (Workable, ~250 calls / 10 min). */
    lanes?: number;
  },
): Promise<SeedYield> {
  const log = options.log ?? (() => undefined);
  const board = boardOf(source);
  const unique = [...new Set(slugs)];
  const [companies, checked] = await Promise.all([
    db.company.findMany({ where: { source }, select: { slug: true, name: true } }),
    db.discoveryCandidate.findMany({ where: { source }, select: { slug: true, name: true } }),
  ]);
  // A recheck looks again at boards checked before (too few India jobs then): only current companies are skipped.
  const skip = options.recheck ? companies : [...companies, ...checked];
  const knownSlugs = new Set(skip.flatMap((row) => (row.slug ? [row.slug.toLowerCase()] : [])));
  const knownNames = new Set(skip.map((row) => normalName(row.name)));
  const shard = options.shard;
  const fresh = unique.filter((slug) => !knownSlugs.has(slug.toLowerCase()) && !knownNames.has(normalName(slug)) && (!shard || shardOf(slug, shard.count) === shard.index));
  const batch = fresh.slice(0, options.limit);
  const result: SeedYield = {
    source,
    seen: slugs.length,
    unique: unique.length,
    known: unique.length - fresh.length,
    remaining: fresh.length - batch.length,
    checked: 0,
    valid: 0,
    notOnBoard: 0,
    failed: 0,
    openJobs: 0,
    indiaJobs: 0,
    passing: 0,
    added: 0,
    paused: 0,
    stopped: false,
    examples: [],
  };
  const pauseMs = (options.pauseMinutes ?? 10) * 60 * 1000;
  const recent: boolean[] = [];
  let pausedUntil = 0;
  let pausesInARow = 0;
  const note = (failed: boolean) => {
    recent.push(failed);
    if (recent.length > PAUSE_WINDOW) recent.shift();
    const fails = recent.filter(Boolean).length;
    if (recent.length < PAUSE_MIN_SEEN) return;
    // Healthy again: the pauses so far no longer count towards giving up.
    if (fails / recent.length < 0.1) pausesInARow = 0;
    if (!failed || fails / recent.length <= PAUSE_SHARE || Date.now() < pausedUntil || result.stopped) return;
    pausesInARow += 1;
    if (pausesInARow > MAX_PAUSES) {
      result.stopped = true;
      log(`seeds ${source}: STOPPED: ${fails} of the last ${recent.length} checks failed after ${MAX_PAUSES} pauses; run it again later`);
      return;
    }
    result.paused += 1;
    pausedUntil = Date.now() + pauseMs;
    recent.length = 0;
    log(`seeds ${source}: PAUSED ${Math.round(pauseMs / 60000)} min: ${fails} checks of the last window failed (the board is pushing back)`);
  };
  let next = 0;
  const worker = async () => {
    while (next < batch.length && !result.stopped) {
      const wait = pausedUntil - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      if (result.stopped) return;
      const slug = batch[next++];
      try {
        const found = await checkCandidate({ slugs: [slug] }, board);
        result.checked += 1;
        if (!found.slug) result.notOnBoard += 1;
        else {
          result.valid += 1;
          result.openJobs += found.openJobs;
          result.indiaJobs += found.indiaJobs;
          const passes = options.watchAll || (found.indiaJobs >= board.minIndiaJobs && (!board.needsFresh || found.freshIndiaJobs >= 1));
          if (passes) {
            result.passing += 1;
            if (result.examples.length < 15) result.examples.push(`${found.slug} (${found.indiaJobs} India jobs)`);
          }
        }
        if (options.write) {
          const status = await recordChecked(board, { name: slug, stage: null, from: options.from }, found, log, { watchAll: options.watchAll });
          if (status === "added") result.added += 1;
        }
        note(false);
      } catch (error) {
        result.checked += 1;
        result.failed += 1;
        log(`seeds ${source}: ${slug}: ${lastLine(error)}`);
        note(true);
      }
      // The daily run's pace: a short pause between boards on each lane.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.lanes ?? CONCURRENCY) }, worker));
  return result;
}
