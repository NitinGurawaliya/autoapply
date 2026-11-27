import type { SiteConnection } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueConnect, SOURCE_CONNECT_QUEUE } from "@/lib/queue";
import { storage } from "@/lib/storage";
import { CANCELLABLE, cancelApplication } from "@/modules/apply/lifecycle";
import { siteListed, userReadOff } from "@/lib/site-flags";
import { SITE_INFO, SITES, siteStateKey, type Site } from "./sites";
import { signStreamToken, STREAM_TOKEN_TTL_MS, streamIdOf, streamSecret } from "./stream-token";
import { deleteLoginNumber } from "./login-number";

/**
 * A user's connection to a signed-in job site (docs/naukri/TDD.md 4.4). Every status change goes through here. No
 * browser: the sign-in itself runs in the worker (modules/apply/sites/connect.ts).
 */

export type ConnectionStatus = "connecting" | "connected" | "needs_signin" | "limited" | "failed" | "disconnected";

/** What the Account page shows for one site. Dates as ISO strings; nothing from the site's pages but the first name. */
export type ConnectionView = {
  site: Site;
  label: string;
  status: ConnectionStatus | "not_connected";
  accountLabel: string | null;
  connectedAt: string | null;
  lastIngestAt: string | null;
  pausedUntil: string | null;
  lastError: string | null;
  updatedAt: string | null;
};

export type SourcesOverview = {
  sites: ConnectionView[];
  /** False for a test profile, or a user with no profile yet: they cannot connect a site. */
  canConnect: boolean;
  /** A worker that can show a window beat in the last few minutes: the sign-in window has somewhere to open. */
  screenWorkerAlive: boolean;
  /** The sites whose shared reader is on (K14, <SITE>_READER=1): our own reader finds their jobs for everyone, so a user's account does not read on request. */
  sharedReaders: string[];
};

// A worker beats every minute (worker/index.ts); five minutes of silence means none is running.
const SCREEN_WORKER_FRESH_MS = 5 * 60 * 1000;
// A connect still "connecting" after this long is treated as abandoned, and Connect may start again.
const CONNECTING_STALE_MS = 15 * 60 * 1000;

function view(site: Site, row: SiteConnection | undefined): ConnectionView {
  return {
    site,
    label: SITE_INFO[site].label,
    status: (row?.status as ConnectionStatus | undefined) ?? "not_connected",
    accountLabel: row?.accountLabel ?? null,
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    lastIngestAt: row?.lastIngestAt?.toISOString() ?? null,
    pausedUntil: row?.pausedUntil?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export async function screenWorkerAlive(now = new Date()) {
  const beat = await db.workerBeat.findFirst({ where: { hasScreen: true, beatAt: { gte: new Date(now.getTime() - SCREEN_WORKER_FRESH_MS) } }, select: { id: true } });
  return Boolean(beat);
}

export async function getConnection(userId: string, site: Site) {
  return db.siteConnection.findUnique({ where: { userId_site: { userId, site } } });
}

export async function sourcesOverview(userId: string): Promise<SourcesOverview> {
  const [rows, profile, screen] = await Promise.all([
    db.siteConnection.findMany({ where: { userId } }),
    db.profile.findUnique({ where: { userId }, select: { isTest: true } }),
    screenWorkerAlive(),
  ]);
  const bySite = new Map(rows.map((row) => [row.site, row]));
  return { sites: SITES.filter((site) => siteListed(site)).map((site) => view(site, bySite.get(site))), canConnect: Boolean(profile && !profile.isTest), screenWorkerAlive: screen, sharedReaders: SITES.filter((site) => userReadOff(site)) };
}

export type StartConnectResult = { ok: true } | { ok: false; reason: "test_profile" | "no_profile" | "no_screen_worker" | "already_connecting" | "queue_failed" };

/**
 * The user accepted the notice and asked to sign in: the connection becomes "connecting" and the worker with a screen
 * opens the site's login page in a visible window. A test profile never connects a real site (CLAUDE.md hard rules).
 */
export async function startConnect(userId: string, site: Site, enqueue: (userId: string, site: Site) => Promise<string | null> = enqueueConnect): Promise<StartConnectResult> {
  const profile = await db.profile.findUnique({ where: { userId }, select: { isTest: true } });
  if (!profile) return { ok: false, reason: "no_profile" };
  if (profile.isTest) return { ok: false, reason: "test_profile" };
  if (!(await screenWorkerAlive())) return { ok: false, reason: "no_screen_worker" };
  const existing = await getConnection(userId, site);
  if (existing?.status === "connecting" && Date.now() - existing.updatedAt.getTime() < CONNECTING_STALE_MS) return { ok: false, reason: "already_connecting" };
  const now = new Date();
  await db.siteConnection.upsert({
    where: { userId_site: { userId, site } },
    create: { userId, site, status: "connecting", consentAt: now },
    update: { status: "connecting", consentAt: now, lastError: null },
  });
  const queued = await enqueue(userId, site).catch(() => null);
  if (!queued) {
    await failConnect(userId, site, "The sign-in window could not be opened. Try again in a minute.");
    return { ok: false, reason: "queue_failed" };
  }
  return { ok: true };
}

/** The person signed in and the sign-in was saved: connected. False when the user withdrew meanwhile (Disconnect). */
export async function finishConnect(userId: string, site: Site, accountLabel: string | null) {
  const now = new Date();
  const moved = await db.siteConnection.updateMany({
    where: { userId, site, status: "connecting" },
    data: { status: "connected", stateKey: siteStateKey(userId, site), accountLabel, connectedAt: now, lastUsedAt: now, pausedUntil: null, lastError: null, streamUrl: null },
  });
  return moved.count > 0;
}

/** The sign-in did not finish (window closed, too slow, nothing saved); `message` is shown on the Account page. */
export async function failConnect(userId: string, site: Site, message: string) {
  await db.siteConnection.updateMany({ where: { userId, site, status: "connecting" }, data: { status: "failed", lastError: message, streamUrl: null } });
}

/**
 * K8: the worker holding this user's sign-in window serves it at `url` (null when the window closes). Set only while
 * the connection is still "connecting", so a Disconnect meanwhile is never undone.
 */
export async function setStreamUrl(userId: string, site: Site, url: string | null) {
  const moved = await db.siteConnection.updateMany({ where: { userId, site, ...(url ? { status: "connecting" } : {}) }, data: { streamUrl: url } });
  return moved.count > 0;
}

export type StreamTicket =
  | { state: "ready"; url: string; token: string; expiresAt: string }
  /** The worker is opening the window, or the stream is not set up on this deploy. */
  | { state: "waiting" | "unavailable" }
  | { state: "ended"; status: ConnectionStatus | "not_connected"; accountLabel: string | null; lastError: string | null };

/**
 * The phone's pass to the user's own streamed sign-in (K8): the worker's address and a token for that window only,
 * valid 10 minutes. Scoped by `userId`, so a user can only ever see their own window; a test profile never gets one.
 */
export async function streamTicket(userId: string, site: Site, now = Date.now()): Promise<StreamTicket> {
  const [row, profile] = await Promise.all([getConnection(userId, site), db.profile.findUnique({ where: { userId }, select: { isTest: true } })]);
  if (!profile || profile.isTest) return { state: "ended", status: "not_connected", accountLabel: null, lastError: null };
  if (row?.status !== "connecting") {
    return { state: "ended", status: (row?.status as ConnectionStatus | undefined) ?? "not_connected", accountLabel: row?.accountLabel ?? null, lastError: row?.lastError ?? null };
  }
  if (!streamSecret()) return { state: "unavailable" };
  const sid = row.streamUrl ? streamIdOf(row.streamUrl) : null;
  if (!row.streamUrl || !sid) return { state: "waiting" };
  const exp = now + STREAM_TOKEN_TTL_MS;
  return { state: "ready", url: row.streamUrl, token: signStreamToken({ sid, uid: userId, site, exp }), expiresAt: new Date(exp).toISOString() };
}

/**
 * A run met the site signed out, or the site asked for a check or refused it (docs/naukri/TDD.md 4.8). Signed out:
 * "needs_signin", never an automatic sign-in. A check or a refusal: "limited", nothing runs for the user on that site
 * until `pausedUntil`. Changes only a connection that is still connected (Disconnect meanwhile wins).
 */
export async function markStopped(userId: string, site: Site, stop: "needs_signin" | "challenge" | "refused", pauseHours: number, now = new Date()) {
  const label = SITE_INFO[site].label;
  const data =
    stop === "needs_signin"
      ? { status: "needs_signin", lastError: `${label} signed you out. Sign in again so your agent can keep going.` }
      : {
          status: "limited",
          pausedUntil: new Date(now.getTime() + pauseHours * 60 * 60 * 1000),
          lastError: stop === "challenge" ? `${label} asked for a check, so your agent paused.` : `${label} turned automated use away for now, so your agent paused.`,
        };
  const moved = await db.siteConnection.updateMany({ where: { userId, site, status: { in: ["connected", "limited"] } }, data });
  return moved.count > 0;
}

/** A run used the saved sign-in and finished reading: when, for the Account page and the next run's checks. */
export async function recordIngest(userId: string, site: Site, now = new Date()) {
  await db.siteConnection.updateMany({ where: { userId, site }, data: { lastIngestAt: now, lastUsedAt: now } });
}

/** Whether the user's connection to the site can be used now: connected, and not paused (a pause that ran out ends). */
export async function usableConnection(userId: string, site: Site, now = new Date()) {
  const row = await getConnection(userId, site);
  if (!row) return null;
  if (row.status === "limited" && row.pausedUntil && row.pausedUntil <= now) {
    await db.siteConnection.updateMany({ where: { id: row.id, status: "limited" }, data: { status: "connected", pausedUntil: null, lastError: null } });
    return { ...row, status: "connected", pausedUntil: null, lastError: null };
  }
  return row.status === "connected" ? row : null;
}

/** Runs of the site for this user since midnight UTC (the per-day budget in config/rules.json signed_in_sources). */
export async function runsToday(userId: string, site: Site, now = new Date()) {
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return db.sourceRun.count({ where: { userId, site, startedAt: { gte: midnight } } });
}

/**
 * Forget the user's sign-in to the site: the saved cookies are deleted at once, a sign-in window still waiting closes
 * (the worker sees the status change), and applications waiting to run on that site are cancelled.
 */
export async function disconnect(userId: string, site: Site) {
  await storage.delete(siteStateKey(userId, site));
  // The number it was connected with goes too (K8b).
  await deleteLoginNumber(userId, site);
  await db.siteConnection.updateMany({
    where: { userId, site },
    data: { status: "disconnected", stateKey: null, accountLabel: null, pausedUntil: null, lastError: null, streamUrl: null },
  });
  await db.$executeRaw`
    UPDATE pgboss.job SET state = 'cancelled', completed_on = now()
    WHERE name = ${SOURCE_CONNECT_QUEUE} AND state IN ('created', 'retry') AND data->>'userId' = ${userId} AND data->>'site' = ${site}`;
  const waiting = await db.$queryRaw<Array<{ id: string }>>`
    SELECT a.id FROM "Application" a JOIN "Job" j ON j.id = a."jobId"
    WHERE a."userId" = ${userId} AND a.status = ANY(${CANCELLABLE}) AND j.source = ${site}`;
  let cancelled = 0;
  for (const application of waiting) {
    if ((await cancelApplication(application.id, userId)) === "cancelled") cancelled += 1;
  }
  return { cancelled };
}
