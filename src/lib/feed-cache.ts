/**
 * Each user's scored feed, kept for a minute in this server process (modules/jobs/match.ts listFeed). The feed only
 * changes when the user swipes, edits their profile or preferred locations, or new jobs arrive (ingest, every 6 h),
 * so a visit within the minute skips the round trips to the database. Writes that change the feed call forgetFeed;
 * new jobs and company results show up when the minute is over. Per process: another server instance, or the
 * worker, keeps its own copy, and the minute bounds how old any copy can be.
 */
const TTL_MS = 60_000;

// On globalThis, like the Prisma client: Next.js bundles route handlers and pages separately, and a plain module-level
// Map would give each bundle its own copy (a swipe saved by /api/swipes would not clear the copy the feed page reads).
const holder = globalThis as unknown as { swipeApplyFeedCache?: Map<string, { at: number; value: unknown }> };
const cache = (holder.swipeApplyFeedCache ??= new Map());

export function cachedFeed<T>(userId: string, filtersKey: string): T | undefined {
  const hit = cache.get(`${userId}\u0000${filtersKey}`);
  if (!hit || Date.now() - hit.at > TTL_MS) return undefined;
  return hit.value as T;
}

export function rememberFeed(userId: string, filtersKey: string, value: unknown) {
  // Old entries go when they are next read; this keeps the map from growing with users who never come back.
  if (cache.size > 2000) for (const [key, entry] of cache) if (Date.now() - entry.at > TTL_MS) cache.delete(key);
  cache.set(`${userId}\u0000${filtersKey}`, { at: Date.now(), value });
}

/**
 * The match score this user's feed showed for a job, from any of their cached feeds still under a minute old; null when
 * none holds it (an older feed, another server instance, a job opened by its link). A swipe checks min_match_score
 * against this, the number on the card, so the card and the swipe cannot disagree (1 Nov verification, finding 3).
 */
export function cachedFeedScore(userId: string, jobId: string): number | null {
  for (const [key, entry] of cache) {
    if (!key.startsWith(`${userId}\u0000`) || Date.now() - entry.at > TTL_MS || !Array.isArray(entry.value)) continue;
    const job = (entry.value as Array<{ id?: unknown; score?: unknown }>).find((item) => item?.id === jobId);
    if (job && typeof job.score === "number") return job.score;
  }
  return null;
}

/** Drop every cached feed of this user (all filters): after a swipe, a profile edit or a change of preferred locations. */
export function forgetFeed(userId: string) {
  for (const key of cache.keys()) if (key.startsWith(`${userId}\u0000`)) cache.delete(key);
}
