import { db } from "@/lib/db";

// A per-user lock held in the database, so it works across several worker processes or machines.
// The holder renews a short lease while it works; if the holder dies, the lease runs out and the next one takes over.

export type LockTiming = { leaseSeconds: number; heartbeatMs: number; pollMs: number };
export const DEFAULT_TIMING: LockTiming = { leaseSeconds: 120, heartbeatMs: 20_000, pollMs: 2_000 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Atomic: takes the lock only if it is free, expired, or already ours. */
async function tryAcquire(userId: string, holderId: string, leaseSeconds: number) {
  const rows = await db.$queryRaw<Array<{ holderId: string }>>`
    INSERT INTO "SubmitLock" ("userId", "holderId", "expiresAt")
    VALUES (${userId}, ${holderId}, now() + (${leaseSeconds}::int * interval '1 second'))
    ON CONFLICT ("userId") DO UPDATE
      SET "holderId" = EXCLUDED."holderId", "expiresAt" = EXCLUDED."expiresAt"
      WHERE "SubmitLock"."expiresAt" < now() OR "SubmitLock"."holderId" = EXCLUDED."holderId"
    RETURNING "holderId"`;
  return rows.length > 0 && rows[0].holderId === holderId;
}

async function renew(userId: string, holderId: string, leaseSeconds: number) {
  await db.$executeRaw`
    UPDATE "SubmitLock" SET "expiresAt" = now() + (${leaseSeconds}::int * interval '1 second')
    WHERE "userId" = ${userId} AND "holderId" = ${holderId}`;
}

async function release(userId: string, holderId: string) {
  await db.$executeRaw`DELETE FROM "SubmitLock" WHERE "userId" = ${userId} AND "holderId" = ${holderId}`;
}

/**
 * Runs `work` while holding this user's lock. `holderId` is the application id.
 * `onWait` is called once if the lock is busy; `shouldStop` is checked while waiting (for cancels).
 */
export async function withSubmitLock<T>(
  userId: string,
  holderId: string,
  hooks: { onWait?: () => Promise<void>; shouldStop?: () => Promise<boolean> },
  work: () => Promise<T>,
  timing: LockTiming = DEFAULT_TIMING,
): Promise<T> {
  let announced = false;
  while (!(await tryAcquire(userId, holderId, timing.leaseSeconds))) {
    if (!announced) {
      announced = true;
      await hooks.onWait?.();
    }
    if (await hooks.shouldStop?.()) throw new LockStopped();
    await sleep(timing.pollMs);
  }
  const beat = setInterval(() => void renew(userId, holderId, timing.leaseSeconds).catch(() => undefined), timing.heartbeatMs);
  try {
    return await work();
  } finally {
    clearInterval(beat);
    await release(userId, holderId).catch(() => undefined);
  }
}

/** The caller asked to stop while waiting for the lock. */
export class LockStopped extends Error {
  constructor() {
    super("Stopped while waiting for the submit lock");
  }
}
