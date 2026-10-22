import { PgBoss } from "pg-boss";
import { db, loadEnvFile } from "@/lib/db";

loadEnvFile();

const APPLY_QUEUE = "apply";
/**
 * Boards where a person presses Submit (human handoff): the worker fills the form in a visible window and waits.
 * Ashby's reCAPTCHA stops a Submit the worker presses itself before anything is sent (21 Oct: 1 of 23 through, and a
 * traced automated run never sent its submit request), while a person's Submit went through 7 of 7.
 */
export const HANDOFF_BOARDS: readonly string[] = ["ashby"];
/** Handoff applications have their own queue: only a worker with a screen takes it (worker/index.ts). */
export const HANDOFF_QUEUE = "apply-handoff";
/** Every queue an application can be on, for code that reads or cancels its queue jobs. */
export const APPLY_QUEUES = [APPLY_QUEUE, HANDOFF_QUEUE];
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
      await ensureQueue(started, INGEST_QUEUE);
      await ensureQueue(started, PRESCAN_QUEUE);
      await ensureQueue(started, DISCOVER_QUEUE);
      return started;
    });
  }
  return bossPromise;
}

/** The queue an application of this board goes on: handoff boards need a worker with a screen. */
export function queueFor(source: string | undefined) {
  return source && HANDOFF_BOARDS.includes(source) ? HANDOFF_QUEUE : APPLY_QUEUE;
}

export async function enqueueApply(applicationId: string, delaySeconds = 0) {
  const boss = await getBoss();
  const [row] = await db.$queryRaw<Array<{ source: string }>>`
    SELECT j.source FROM "Application" a JOIN "Job" j ON j.id = a."jobId" WHERE a.id = ${applicationId}`;
  const queue = queueFor(row?.source);
  // One hour covers a form plus waiting behind another application's security code, or a person pressing Submit (15
  // minutes); no automatic pg-boss retry, because the runner retries on its own and a blind re-run could apply twice.
  return boss.send(queue, { applicationId }, { expireInSeconds: 3600, retryLimit: 0, ...(delaySeconds > 0 ? { startAfter: delaySeconds } : {}) });
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
