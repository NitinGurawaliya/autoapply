import { getBoss } from "@/lib/queue";
import { handleApply } from "./handlers/apply";
import { handleIngest } from "./handlers/ingest";

async function main() {
  const boss = await getBoss();
  await boss.work("apply", handleApply);
  await boss.work("ingest", handleIngest);
  console.log("worker listening for apply and ingest");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "worker failed");
  process.exit(1);
});
