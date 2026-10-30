import { PgBoss } from "pg-boss";
import { protectionLevel, UNPROTECTED } from "@/lib/ashby-protection";
import { db, loadEnvFile } from "@/lib/db";

loadEnvFile();

const APPLY_QUEUE = "apply";
/**
 * Boards where a person presses Submit (human handoff): the worker fills the form in a visible window and waits.
 * Ashby's reCAPTCHA stops a Submit the worker presses itself before anything is sent (21 Oct: 1 of 23 through, and a
 * traced automated run never sent its submit request), while a person's Submit went through 7 of 7.
 */
export const HANDOFF_BOARDS: readonly string[] = ["ashby"];
/**
 * Handoff applications of a company that set Ashby's spam protection (low, medium, high, or unreadable): only a worker with
 * a screen takes them (worker/index.ts). It fills the form in a visible Chrome window and, with ASHBY_AUTO_SUBMIT=1,
 * presses Submit itself; a challenge hands the window to the person. Headless, every such Submit was challenged (21-27
 * Oct: 31 of 31); in a visible window the worker's own click went through at "low" (27 Oct: 5 of 6).
 */
export const HANDOFF_QUEUE = "apply-handoff";
/**
 * Handoff applications of a company with no spam protection ("job_apply_none"): a worker presses Submit itself, so a
 * headless Docker worker with ASHBY_AUTO_SUBMIT=1 takes them as well as a worker with a screen (21-27 Oct: 8 of 8 sent).
 */
export const UNPROTECTED_QUEUE = "apply-unprotected";
/**
 * Handoff applications the board already asked a person for (Ashby's bot check stopped a worker's own Submit): only a
 * worker with a screen takes them, and a person presses Submit there, never the worker.
 */
export const PERSON_QUEUE = "apply-person";
/** Every queue an application can be on, for code that reads or cancels its queue jobs. */
export const APPLY_QUEUES = [APPLY_QUEUE, HANDOFF_QUEUE, UNPROTECTED_QUEUE, PERSON_QUEUE];
const INGEST_QUEUE = "ingest";
const PRESCAN_QUEUE = "prescan";
const DISCOVER_QUEUE = "discover";

let bossPromise: Promise<PgBoss> | null = null;

async function ensureQueue(boss: PgBoss, name: string) {
  const existing = await boss.getQueue(name);
  if (!existing) await boss.createQueue(name);
}

export function getBoss() {
  if (!bossPromise) {
    const connectionString = process.env.DIRECT_URL;
    if (!connectionString) throw new Error("DIRECT_URL is not set");
    const boss = new PgBoss(connectionString);
    // A lost connection (Wi-Fi drop, DNS failure, Neon waking up) is reported as an "error" event; with no listener Node
    // treats it as fatal and the whole worker exits (11/12 Oct: "getaddrinfo ENOTFOUND"). pg-boss keeps polling and
    // recovers by itself once the network is back, so the error is only logged.
    boss.on("error", (error: Error) => console.error(`queue: ${error.message.slice(0, 160)}`));
    bossPromise = boss.start().then(async (started) => {
      await ensureQueue(started, APPLY_QUEUE);
      await ensureQueue(started, HANDOFF_QUEUE);
      await ensureQueue(started, UNPROTECTED_QUEUE);
      await ensureQueue(started, PERSON_QUEUE);
      await ensureQueue(started, INGEST_QUEUE);
      await ensureQueue(started, PRESCAN_QUEUE);
      await ensureQueue(started, DISCOVER_QUEUE);
      return started;
    });
  }
  return bossPromise;
}

/**
 * The queue an application of this board goes on: handoff boards need a worker with a screen, unless the company's Ashby
 * protection level is "none" (`level`, from lib/ashby-protection.ts). Anything else, an unread level included, needs a screen.
 */
export function queueFor(source: string | undefined, level?: string | null) {
  if (!source || !HANDOFF_BOARDS.includes(source)) return APPLY_QUEUE;
  return level === UNPROTECTED ? UNPROTECTED_QUEUE : HANDOFF_QUEUE;
}

/** The event that hands an application to a person (runner.ts), and the one that starts it afresh (lifecycle.ts retry). */
export const PERSON_HANDOFF = "Ashby asked to confirm a person is applying, so a person presses Submit";
const RETRIED_BY_YOU = "Retried by you";
/** How long a person handoff waits for a worker with a screen before it fails (worker/reaper.ts). */
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

/** `person`: true sends it to a person, false starts it afresh (the user's Retry); left out, it stays where it is. */
export async function enqueueApply(applicationId: string, delaySeconds = 0, options: { person?: boolean } = {}) {
  const boss = await getBoss();
  const [row] = await db.$queryRaw<Array<{ source: string; applyUrl: string }>>`
    SELECT j.source, j."applyUrl" FROM "Application" a JOIN "Job" j ON j.id = a."jobId" WHERE a.id = ${applicationId}`;
  const handoff = Boolean(row && HANDOFF_BOARDS.includes(row.source));
  const person =
    handoff &&
    (options.person ??
      withPerson(await db.applicationEvent.findMany({ where: { applicationId, OR: [{ type: "ask_user", message: { startsWith: PERSON_HANDOFF } }, { type: "retry", message: { startsWith: RETRIED_BY_YOU } }] }, select: { type: true, message: true, createdAt: true } })));
  // Read on every enqueue (a company can change its setting); a short wait, since a swipe waits on it, and a level not read
  // in time sends the application to a worker with a screen.
  const level = row && handoff && !person ? await protectionLevel(row.applyUrl, 4000) : null;
  const queue = person ? PERSON_QUEUE : queueFor(row?.source, level);
  // One hour covers a form plus waiting behind another application's security code, or a person pressing Submit (15
  // minutes); no automatic pg-boss retry, because the runner retries on its own and a blind re-run could apply twice.
  const data = person ? { applicationId, person: true } : { applicationId };
  return boss.send(queue, data, { expireInSeconds: 3600, retryLimit: 0, ...(delaySeconds > 0 ? { startAfter: delaySeconds } : {}) });
}

export async function enqueueIngest(days: number) {
  const boss = await getBoss();
  // Two hours covers hundreds of companies; a run that overlaps another skips itself (modules/jobs/ingest.ts).
  return boss.send(INGEST_QUEUE, { days }, { expireInSeconds: 7200, retryLimit: 0 });
}

/**
 * Pre-scan a user's feed for missing facts (modules/apply/prescan.ts); at most one per user and reason every 10
 * minutes. Building the feed also caches the model's verdicts on its jobs, so a scan queued when a resume is read
 * ("resume") or confirmed ("profile") makes the first feed a read instead of a wait (16 Oct QA: 10-15 s for a new user).
 */
export async function enqueuePrescan(userId: string, reason = "answers") {
  const boss = await getBoss();
  return boss.send(PRESCAN_QUEUE, { userId }, { singletonKey: `${userId}:${reason}`, singletonSeconds: 600, expireInSeconds: 1800, retryLimit: 0 });
}
