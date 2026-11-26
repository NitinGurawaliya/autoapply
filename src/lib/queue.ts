import { PgBoss } from "pg-boss";
import { db, loadEnvFile } from "@/lib/db";

loadEnvFile();

/**
 * One queue for every application (owner, 18 Nov). Every run is the stealthy Chrome (modules/apply/real-browser.ts), a
 * visible window: the worker fills the form and presses Submit itself, and a challenge the board still shows (an image
 * CAPTCHA, a bot check) hands that window to the person. So only a worker with a screen takes this queue (worker/index.ts);
 * the Docker worker reads jobs only. The earlier split by screen and Ashby protection level (apply-handoff,
 * apply-unprotected, apply-person, ASHBY_AUTO_SUBMIT) is gone.
 */
export const APPLY_QUEUE = "apply";
/** The queues before 18 Nov: a worker with a screen still empties them, and cancel and reap code still reads them. */
export const LEGACY_APPLY_QUEUES = ["apply-handoff", "apply-unprotected", "apply-person"];
/** Every queue an application can be on, for code that reads or cancels its queue jobs. */
/**
 * Applications on a site the user signs in to (Naukri, ARCHITECTURE 6.20): their own queue, taken only by a worker
 * running the signed-in-site code, so a worker on older code never picks one up and fails it.
 */
export const SITE_APPLY_QUEUE = "apply-site";
/** The sources whose applications go on SITE_APPLY_QUEUE (modules/sources/sites.ts SITES). */
const SIGNED_IN_SOURCES: readonly string[] = ["naukri"];
export const APPLY_QUEUES = [APPLY_QUEUE, ...LEGACY_APPLY_QUEUES, SITE_APPLY_QUEUE];
/**
 * Boards whose challenge goes to the person in the window (the adapters' `ctx.handoff`), and where an Ashby check, once
 * shown, keeps later runs of that application with the person (`withPerson`).
 * Keka (T96) and Zoho Recruit (M13, read by the worker since 21 Nov): image CAPTCHAs the worker reads in the form's window;
 * on Zoho one the reader cannot read goes to the person. Ashby, Lever, Workable, SmartRecruiters: the worker presses
 * Submit and a challenge goes to the person.
 */
export const HANDOFF_BOARDS: readonly string[] = ["ashby", "keka", "lever", "workable", "zohorecruit", "smartrecruiters"];
const INGEST_QUEUE = "ingest";
/**
 * Signing in to a user's own job-site account (Phase K, docs/naukri/TDD.md 4.2, 4.5): the site's login page in a visible
 * window, where the person signs in themselves. Only a worker with a screen takes it (worker/index.ts).
 */
export const SOURCE_CONNECT_QUEUE = "source-connect";
/** One user's run on a signed-in site (docs/naukri/TDD.md 4.6): their window, so only a worker with a screen takes it. */
export const INGEST_SOURCE_QUEUE = "ingest-source";
/** The schedule that hands each connected user a run (worker/schedule.ts SOURCE_INGEST_CRON); any worker takes it. */
export const SOURCE_INGEST_TICK = "source-ingest-tick";
/** The shared reader (K14): the plan tick keeps the search buckets and queues a window when some are due; a window reads them. */
export const READER_PLAN_QUEUE = "reader-plan";
export const READER_RUN_QUEUE = "reader-run";
const PRESCAN_QUEUE = "prescan";
const DISCOVER_QUEUE = "discover";
/** The daily per-board measurement (Phase M, M1; modules/jobs/boardDay.ts). */
export const BOARD_DAY_QUEUE = "board-day";
/** Tick mode (INGEST_MODE=tick, M2): every few minutes the tick sends each company due for a read its own job. */
export const INGEST_TICK_QUEUE = "ingest-tick";
export const INGEST_COMPANY_QUEUE = "ingest-company";

async function ensureQueue(boss: PgBoss, name: string, options?: Parameters<PgBoss["createQueue"]>[1]) {
  const existing = await boss.getQueue(name);
  if (!existing) await boss.createQueue(name, options);
}

// One started queue per process, kept on globalThis (e2e verify, 18 Nov): as a module variable each route bundle
// (swipes, answers, retry, every after()) started its own pg-boss on first use, 2.5 s for start() plus 1.7 s for seven
// queue checks one after another, about 4.2 s per bundle, and each ran the queue's maintenance in the web process.
const global = globalThis as unknown as { swipeapplyBoss?: Promise<PgBoss> };

/**
 * The queue. `role: "worker"` (src/worker) also runs pg-boss's maintenance and schedules; the web app only sends jobs,
 * so it starts without either. Queues are checked in parallel, once per process.
 */
export function getBoss(role: "web" | "worker" = "web") {
  if (!global.swipeapplyBoss) {
    const connectionString = process.env.DIRECT_URL;
    if (!connectionString) throw new Error("DIRECT_URL is not set");
    const boss = new PgBoss(role === "worker" ? { connectionString } : { connectionString, supervise: false, schedule: false });
    // A lost connection (Wi-Fi drop, DNS failure, Neon waking up) is reported as an "error" event; with no listener Node
    // treats it as fatal and the whole worker exits (11/12 Oct: "getaddrinfo ENOTFOUND"). pg-boss keeps polling and
    // recovers by itself once the network is back, so the error is only logged.
    boss.on("error", (error: Error) => console.error(`queue: ${error.message.slice(0, 160)}`));
    const starting = boss.start().then(async (started) => {
      await Promise.all([
        ...[...APPLY_QUEUES, INGEST_QUEUE, PRESCAN_QUEUE, DISCOVER_QUEUE, BOARD_DAY_QUEUE, INGEST_TICK_QUEUE, SOURCE_CONNECT_QUEUE, INGEST_SOURCE_QUEUE, SOURCE_INGEST_TICK, READER_PLAN_QUEUE, READER_RUN_QUEUE].map((name) => ensureQueue(started, name)),
        // One job per company at most, queued or running: a company still waiting is not sent again by the next tick.
        ensureQueue(started, INGEST_COMPANY_QUEUE, { policy: "exclusive" }),
      ]);
      return started;
    });
    // A start that fails (network down) is not cached, so the next call tries again.
    starting.catch(() => {
      if (global.swipeapplyBoss === starting) global.swipeapplyBoss = undefined;
    });
    global.swipeapplyBoss = starting;
  }
  return global.swipeapplyBoss;
}

/** The event that hands an application to a person (runner.ts), and the one that starts it afresh (lifecycle.ts retry). */
export const PERSON_HANDOFF = "Ashby asked to confirm a person is applying, so a person presses Submit";
const RETRIED_BY_YOU = "Retried by you";
/** How long an application waits for a worker with a screen before it fails (worker/reaper.ts). */
export const PERSON_WAIT_HOURS = 24;

/**
 * Whether the application is with a person: handed over (PERSON_HANDOFF) and not retried by the user since. Every later
 * run stays with a person (a retry after an error, the window opened again, an answer given, a run picked up again):
 * Ashby's check comes back on a rerun (24-25 Oct: 0 of 7 through).
 */
export function withPerson(events: Array<{ type: string; message: string; createdAt: Date }>) {
  const marks = events.filter((event) => (event.type === "ask_user" && event.message.startsWith(PERSON_HANDOFF)) || (event.type === "retry" && event.message.startsWith(RETRIED_BY_YOU)));
  const last = marks.reduce<(typeof marks)[number] | null>((latest, event) => (!latest || event.createdAt >= latest.createdAt ? event : latest), null);
  return last?.type === "ask_user";
}

/**
 * `person`: true sends it to a person, false starts it afresh (the user's Retry); left out, it stays where it is.
 * `job`: the application's job when the caller already read it (a swipe), so it is not read again.
 */
export async function enqueueApply(applicationId: string, delaySeconds = 0, options: { person?: boolean; job?: { source: string; applyUrl: string } } = {}) {
  const boss = await getBoss();
  const [row] = options.job
    ? [options.job]
    : await db.$queryRaw<Array<{ source: string; applyUrl: string }>>`
    SELECT j.source, j."applyUrl" FROM "Application" a JOIN "Job" j ON j.id = a."jobId" WHERE a.id = ${applicationId}`;
  const handoff = Boolean(row && HANDOFF_BOARDS.includes(row.source));
  const person =
    handoff &&
    (options.person ??
      withPerson(await db.applicationEvent.findMany({ where: { applicationId, OR: [{ type: "ask_user", message: { startsWith: PERSON_HANDOFF } }, { type: "retry", message: { startsWith: RETRIED_BY_YOU } }] }, select: { type: true, message: true, createdAt: true } })));
  // One hour covers a form plus waiting behind another application's security code, or a person pressing Submit (15
  // minutes); no automatic pg-boss retry, because the runner retries on its own and a blind re-run could apply twice.
  const data = person ? { applicationId, person: true } : { applicationId };
  const queue = row && SIGNED_IN_SOURCES.includes(row.source) ? SITE_APPLY_QUEUE : APPLY_QUEUE;
  return boss.send(queue, data, { expireInSeconds: 3600, retryLimit: 0, ...(delaySeconds > 0 ? { startAfter: delaySeconds } : {}) });
}

/**
 * One company's read in tick mode (M2). Grouped by board, so the worker caps how many reads of one board run at once
 * across every worker (`groupConcurrency`, INGEST_PER_HOST); one job per company (the queue's exclusive policy).
 */
export async function enqueueIngestCompany(companyId: string, board: string, runId: string) {
  const boss = await getBoss();
  return boss.send(INGEST_COMPANY_QUEUE, { companyId, runId }, { singletonKey: companyId, group: { id: board }, expireInSeconds: 15 * 60, retryLimit: 0 });
}

/**
 * The same for a whole tick's due companies, 500 to an insert: one `send` per company took ~0.35 s against Neon (899
 * in 5 min on 10 Nov), so 2,000 would outlast the tick. A company already waiting or running is skipped by the
 * queue's exclusive policy (the insert's ON CONFLICT DO NOTHING); returns how many were queued.
 */
export async function enqueueIngestCompanies(companies: Array<{ id: string; source: string; groupTier?: string }>, runId: string) {
  const boss = await getBoss();
  let sent = 0;
  for (let start = 0; start < companies.length; start += 500) {
    const jobs = companies.slice(start, start + 500).map((company) => ({
      data: { companyId: company.id, runId },
      singletonKey: company.id,
      // A gentle board's group tier ("gentle", modules/jobs/cadence.ts) is read one company at a time (worker/index.ts).
      group: company.groupTier ? { id: company.source, tier: company.groupTier } : { id: company.source },
      expireInSeconds: 15 * 60,
      retryLimit: 0,
    }));
    const ids = await boss.insert(INGEST_COMPANY_QUEUE, jobs, { returnId: true });
    sent += ids?.length ?? 0;
  }
  return sent;
}

export async function enqueueIngest(days: number) {
  const boss = await getBoss();
  // Two hours covers hundreds of companies; a run that overlaps another skips itself (modules/jobs/ingest.ts).
  return boss.send(INGEST_QUEUE, { days }, { expireInSeconds: 7200, retryLimit: 0 });
}

/**
 * Discovery on one board (modules/jobs/discovery.ts), its own job: the daily run gives each board one, so a slow board
 * (Greenhouse took 52 minutes on 2 Nov) cannot run the whole job past its time and leave the next boards out (Ashby
 * had not run since 1 Nov, Keka never). Four hours each; at most one per board queued or running.
 */
export async function enqueueDiscover(board: string) {
  const boss = await getBoss();
  return boss.send(DISCOVER_QUEUE, { board }, { singletonKey: `discover:${board}`, expireInSeconds: 4 * 3600, retryLimit: 0 });
}

/**
 * Pre-scan a user's feed for missing facts (modules/apply/prescan.ts); at most one per user and reason every 10
 * minutes. Building the feed also caches the model's verdicts on its jobs, so a scan queued when a resume is read
 * ("resume") or confirmed ("profile") makes the first feed a read instead of a wait (16 Oct QA: 10-15 s for a new user).
 */
/**
 * Open the site's sign-in for one user. At most one queued or running per user and site; 15 minutes covers the 10-minute
 * wait for the person; no retry (the user presses Connect again).
 */
export async function enqueueConnect(userId: string, site: string) {
  const boss = await getBoss();
  return boss.send(SOURCE_CONNECT_QUEUE, { userId, site }, { singletonKey: `connect:${site}:${userId}`, expireInSeconds: 900, retryLimit: 0 });
}

/** One run for one user and site; at most one queued or running each. 30 minutes covers a run's few pages. */
export async function enqueueSourceIngest(userId: string, site: string, by?: "tick") {
  const boss = await getBoss();
  return boss.send(INGEST_SOURCE_QUEUE, { userId, site, ...(by ? { by } : {}) }, { singletonKey: `ingest:${site}:${userId}`, expireInSeconds: 1800, retryLimit: 0 });
}

/** One window of the shared reader (K14): at most one per reader at a time. */
export async function enqueueReaderRun(site: string, reader: number) {
  const boss = await getBoss();
  return boss.send(READER_RUN_QUEUE, { site, reader }, { singletonKey: `reader:${site}:${reader}`, expireInSeconds: 3600, retryLimit: 0 });
}

export async function enqueuePrescan(userId: string, reason = "answers") {
  const boss = await getBoss();
  return boss.send(PRESCAN_QUEUE, { userId }, { singletonKey: `${userId}:${reason}`, singletonSeconds: 600, expireInSeconds: 1800, retryLimit: 0 });
}
