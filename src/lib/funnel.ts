import { db } from "@/lib/db";

/**
 * The share-link funnel (Phase U7, docs/share/TDD.md 4.2 and 4.7). One row per visitor, job and step, written at most
 * once (a unique key). A write never throws and never holds a page: callers run it in `after()`, the worker awaits it
 * with nothing depending on it. No personal data: the visitor id is random (the `sa_vid` cookie, set by the proxy on
 * share pages); the user id joins once they sign in.
 */

export const FUNNEL_STEPS = ["view", "apply_tap", "signed_in", "resume_read", "profile_saved", "queued", "blocked", "landed", "submitted"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
// li, x, wa: the owner's posts (scripts/share-link.ts --s); app: shared from a job page in the app (U9); co: opened from a company page (Phase W6).
export const SOURCES = ["li", "x", "wa", "copy", "app", "co"] as const;

/** A link's ?s= as a known source, or null. */
export function funnelSource(value: unknown): string | null {
  return typeof value === "string" && (SOURCES as readonly string[]).includes(value) ? value : null;
}

export type FunnelContext = { jobId: string; visitorId: string | null; userId?: string | null; source?: string | null; detail?: string | null };

/** Records a step; true when written or already there, false when it could not be (logged, never thrown). */
export async function track(step: FunnelStep, context: FunnelContext): Promise<boolean> {
  try {
    // Without the cookie (an API call from elsewhere), a signed-in user still counts once, under their own key.
    const visitorId = context.visitorId ?? (context.userId ? `u_${context.userId}` : null);
    if (!visitorId || !context.jobId) return false;
    await db.funnelEvent.createMany({
      data: [{ step, visitorId, jobId: context.jobId, userId: context.userId ?? null, source: context.source ?? null, detail: context.detail ?? null }],
      skipDuplicates: true,
    });
    return true;
  } catch (error) {
    console.warn(`funnel ${step} not recorded: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return false;
  }
}

/** The worker, when an application is sent: `submitted` for an application a share link queued. */
export async function trackSubmitted(applicationId: string): Promise<void> {
  try {
    const queued = await db.funnelEvent.findFirst({ where: { step: "queued", detail: applicationId } });
    if (!queued) return;
    await track("submitted", { jobId: queued.jobId, visitorId: queued.visitorId, userId: queued.userId, detail: applicationId });
  } catch (error) {
    console.warn(`funnel submitted not recorded: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

export type FunnelReport = { since: Date; rows: Array<{ source: string; counts: Record<FunnelStep, number> }> };

/**
 * Visitors per step since a date, by the source of their view (`none` for a link without ?s=, `all` for the total).
 * A visitor counts once per step however many jobs they opened.
 */
export async function funnelReport(since: Date, visitorPrefix?: string): Promise<FunnelReport> {
  const rows = await db.$queryRaw<Array<{ source: string | null; step: string; visitors: bigint }>>`
    WITH first_source AS (
      SELECT DISTINCT ON ("visitorId") "visitorId", source FROM "FunnelEvent"
      WHERE step = 'view' AND at >= ${since}
      ORDER BY "visitorId", at
    )
    SELECT fs.source, e.step, count(DISTINCT e."visitorId") AS visitors
    FROM "FunnelEvent" e LEFT JOIN first_source fs ON fs."visitorId" = e."visitorId"
    WHERE e.at >= ${since} AND (${visitorPrefix ?? null}::text IS NULL OR e."visitorId" LIKE ${`${visitorPrefix ?? ""}%`})
    GROUP BY fs.source, e.step`;
  const empty = () => Object.fromEntries(FUNNEL_STEPS.map((step) => [step, 0])) as Record<FunnelStep, number>;
  const bySource = new Map<string, Record<FunnelStep, number>>();
  // Each visitor has one first source (or none), so the sources add up to the total.
  const all = empty();
  for (const row of rows) {
    if (!(FUNNEL_STEPS as readonly string[]).includes(row.step)) continue;
    const key = row.source ?? "none";
    const target = bySource.get(key) ?? empty();
    target[row.step as FunnelStep] += Number(row.visitors);
    all[row.step as FunnelStep] += Number(row.visitors);
    bySource.set(key, target);
  }
  return { since, rows: [...[...bySource.entries()].map(([source, counts]) => ({ source, counts })), { source: "all", counts: all }] };
}
