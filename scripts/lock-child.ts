// Helper for queue-smoke.ts: a second process that takes a user's submit lock and holds it for a while.
// node args: <userId> <holderId> <holdMs>. Prints START and END with epoch milliseconds.
import { db } from "../src/lib/db";
import { withSubmitLock } from "../src/modules/apply/submitLock";

const [userId, holderId, holdMs] = process.argv.slice(2);

withSubmitLock(userId, holderId, {}, async () => {
  console.log(`START ${Date.now()}`);
  await new Promise((resolve) => setTimeout(resolve, Number(holdMs)));
  console.log(`END ${Date.now()}`);
}, { leaseSeconds: 5, heartbeatMs: 500, pollMs: 100 })
  .catch((error) => console.log("CHILD ERROR", error instanceof Error ? error.message : error))
  .finally(async () => {
    await db.$disconnect();
    process.exit(0);
  });
