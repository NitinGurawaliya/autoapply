import { PgBoss } from "pg-boss";
import { loadEnvFile } from "@/lib/db";

loadEnvFile();

const APPLY_QUEUE = "apply";
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
      await ensureQueue(started, INGEST_QUEUE);
      await ensureQueue(started, PRESCAN_QUEUE);
      await ensureQueue(started, DISCOVER_QUEUE);
      return started;
    });
  }
  return bossPromise;
}

export async function enqueueApply(applicationId: string, delaySeconds = 0) {
  const boss = await getBoss();
  // One hour covers a form plus waiting behind another application's security code; no automatic pg-boss retry,
  // because the runner retries on its own and a blind re-run of a submitted form could apply twice.
  return boss.send(APPLY_QUEUE, { applicationId }, { expireInSeconds: 3600, retryLimit: 0, ...(delaySeconds > 0 ? { startAfter: delaySeconds } : {}) });
}

export async function enqueueIngest(days: number) {
  const boss = await getBoss();
  // Two hours covers hundreds of companies; a run that overlaps another skips itself (modules/jobs/ingest.ts).
  return boss.send(INGEST_QUEUE, { days }, { expireInSeconds: 7200, retryLimit: 0 });
}

/** Pre-scan a user's feed for missing facts (modules/apply/prescan.ts); at most one per user every 10 minutes. */
export async function enqueuePrescan(userId: string) {
  const boss = await getBoss();
  return boss.send(PRESCAN_QUEUE, { userId }, { singletonKey: userId, singletonSeconds: 600, expireInSeconds: 1800, retryLimit: 0 });
}
