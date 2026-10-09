// Cancels everything waiting or running in the apply queue and marks those applications cancelled (history is kept).
// npx tsx scripts/clear-queue.ts
import { db } from "../src/lib/db";

async function main() {
  const apps = await db.application.findMany({
    where: { status: { in: ["queued", "inspecting", "filling", "needs_input"] } },
    select: { id: true },
  });
  const ids = apps.map((app) => app.id);
  // Mark applications first so a worker that picks anything up (or retries) sees "cancelled" and stops.
  const marked = await db.application.updateMany({
    where: { id: { in: ids } },
    data: { status: "cancelled", error: "Cancelled: queue cleared", pendingQuestions: [], verificationCode: null },
  });
  const jobs = await db.$executeRawUnsafe(
    `update pgboss.job set state = 'cancelled', completed_on = now() where name = 'apply' and state in ('created', 'retry', 'active')`,
  );
  for (const id of ids) {
    await db.applicationEvent.create({ data: { applicationId: id, type: "cancel", message: "Cancelled: queue cleared" } });
  }
  const left = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `select count(*) n from pgboss.job where name = 'apply' and state in ('created', 'retry', 'active')`,
  );
  console.log(`CLEARED applications cancelled: ${marked.count}, queue jobs cancelled: ${jobs}, still in queue: ${Number(left[0].n)}`);
  await db.$disconnect();
}

main();
