import { PgBoss } from "pg-boss";
import { loadEnvFile } from "@/lib/db";

loadEnvFile();

const APPLY_QUEUE = "apply";
const INGEST_QUEUE = "ingest";

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
    bossPromise = boss.start().then(async (started) => {
      await ensureQueue(started, APPLY_QUEUE);
      await ensureQueue(started, INGEST_QUEUE);
      return started;
    });
  }
  return bossPromise;
}

export async function enqueueApply(applicationId: string) {
  const boss = await getBoss();
  return boss.send(APPLY_QUEUE, { applicationId });
}

export async function enqueueIngest(days: number) {
  const boss = await getBoss();
  return boss.send(INGEST_QUEUE, { days }, { expireInSeconds: 1800, retryLimit: 0 });
}
