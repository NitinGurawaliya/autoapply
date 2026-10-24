import { db } from "@/lib/db";
import { BOARDS, checkCandidate, CONCURRENCY, normalName, recordChecked, slugsFromCrawl, type Board } from "./discovery";

// Board seeds from free sources only (24 Oct): the Common Crawl index and URL lists collected by hand. Each seed is a
// board identifier on one ATS; it is deduplicated, its public job feed is checked, and (only with `write`) the result is
// recorded through the same path as the daily discovery, so a board is never checked as new twice.

export type SeedSource = "greenhouse" | "lever" | "ashby";
export const SEED_SOURCES: SeedSource[] = ["greenhouse", "lever", "ashby"];

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
    const found = line.match(/(?:https?:\/\/)?(?:www\.)?(?:job-boards(?:\.eu)?|boards(?:\.eu)?)\.greenhouse\.io\/[^\s,;"'<>)]+|(?:https?:\/\/)?jobs(?:\.eu)?\.lever\.co\/[^\s,;"'<>)]+|(?:https?:\/\/)?jobs\.ashbyhq\.com\/[^\s,;"'<>)]+/gi) ?? [];
    urls += found.length;
    for (const address of found) {
      const seed = boardFromUrl(address);
      if (seed) seeds.push(seed);
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
  examples: string[];
};

/**
 * Checks up to `limit` new board identifiers of one ATS, at the daily run's pace. A dry run only reads the boards'
 * public feeds; `write` records every checked board (DiscoveryCandidate, `from`) and adds the passing companies.
 */
export async function verifySeeds(
  source: SeedSource,
  slugs: string[],
  options: { limit: number; write: boolean; from: "crawl" | "import" | "list"; recheck?: boolean; log?: (line: string) => void },
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
  const fresh = unique.filter((slug) => !knownSlugs.has(slug) && !knownNames.has(normalName(slug)));
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
    examples: [],
  };
  let next = 0;
  const worker = async () => {
    while (next < batch.length) {
      const slug = batch[next++];
      try {
        const found = await checkCandidate({ slugs: [slug] }, board);
        result.checked += 1;
        if (!found.slug) result.notOnBoard += 1;
        else {
          result.valid += 1;
          result.openJobs += found.openJobs;
          result.indiaJobs += found.indiaJobs;
          const passes = found.indiaJobs >= board.minIndiaJobs && (!board.needsFresh || found.freshIndiaJobs >= 1);
          if (passes) {
            result.passing += 1;
            if (result.examples.length < 15) result.examples.push(`${found.slug} (${found.indiaJobs} India jobs)`);
          }
        }
        if (options.write) {
          const status = await recordChecked(board, { name: slug, stage: null, from: options.from }, found, log);
          if (status === "added") result.added += 1;
        }
      } catch (error) {
        result.checked += 1;
        result.failed += 1;
        log(`seeds ${source}: ${slug}: ${error instanceof Error ? error.message.slice(0, 80) : "failed"}`);
      }
      // The daily run's pace: a short pause between boards on each lane.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return result;
}
