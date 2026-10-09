import { db } from "@/lib/db";

/**
 * Counts an action against `key` and says whether it is allowed: at most `max` per `windowSeconds`.
 * Parallel requests cannot both slip under the limit.
 */
export async function rateLimit(key: string, max: number, windowSeconds: number) {
  // Count-then-insert is not atomic on its own: two requests can both count under the limit. A per-key lock makes the
  // pair one step, shared across every web instance because it lives in the database.
  const rows = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    return tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "RateEvent" ("id", "key")
      SELECT ${crypto.randomUUID()}, ${key}
      WHERE (SELECT count(*) FROM "RateEvent" WHERE "key" = ${key} AND "createdAt" > now() - (${windowSeconds}::int * interval '1 second')) < ${max}
      RETURNING "id"`;
  }, { maxWait: 20000, timeout: 20000 });
  const ok = rows.length > 0;
  if (ok) return { ok: true as const, retryAfterSeconds: 0 };
  const oldest = await db.$queryRaw<Array<{ createdAt: Date }>>`
    SELECT "createdAt" FROM "RateEvent" WHERE "key" = ${key} AND "createdAt" > now() - (${windowSeconds}::int * interval '1 second')
    ORDER BY "createdAt" ASC LIMIT 1`;
  const wait = oldest[0] ? Math.ceil((oldest[0].createdAt.getTime() + windowSeconds * 1000 - Date.now()) / 1000) : windowSeconds;
  return { ok: false as const, retryAfterSeconds: Math.max(1, wait) };
}

/** Old events are only needed for the longest window; the worker calls this now and then. */
export async function pruneRateEvents(olderThanHours = 48) {
  return db.$executeRaw`DELETE FROM "RateEvent" WHERE "createdAt" < now() - (${olderThanHours}::int * interval '1 hour')`;
}
