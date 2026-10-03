import { enqueueIngest, getBoss } from "../src/lib/queue";

function readDays() {
  const index = process.argv.indexOf("--days");
  const days = Number(process.argv[index + 1]);
  if (!Number.isFinite(days) || days < 1) {
    console.error("usage: npm run ingest -- --days N");
    process.exit(1);
  }
  return days;
}

async function main() {
  const days = readDays();
  const id = await enqueueIngest(days);
  if (!id) throw new Error("failed to enqueue ingest");
  console.log(`enqueued ingest ${id} days=${days}`);

  const boss = await getBoss();
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const [job] = await boss.findJobs<{ days: number }>("ingest", { id });
    if (job?.state === "completed") {
      console.log("ingest completed");
      await boss.stop();
      return;
    }
    if (job?.state === "failed" || job?.state === "cancelled") {
      throw new Error(`ingest ${job.state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("ingest timed out");
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "ingest failed");
  process.exit(1);
});
