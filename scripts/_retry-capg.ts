// Ad hoc (23 Nov): the app's Retry on the latest Capgemini Workable application (owner: "Yes, retry it").
import { db } from "../src/lib/db";
import { retryApplication } from "../src/modules/apply/lifecycle";
async function main() {
  const rows = await db.$queryRawUnsafe<Array<{ id: string; userId: string; status: string }>>(`select a.id, a."userId", a.status from "Application" a join "Job" j on j.id=a."jobId" join "Company" c on c.id=j."companyId" where j.source='workable' and c.name='Capgemini' order by a."updatedAt" desc limit 1`);
  const app = rows[0];
  console.log(`before: ${app.id} ${app.status}`);
  console.log(`retry: ${JSON.stringify(await retryApplication(app.id, app.userId))}`);
  await db.$disconnect();
  process.exit(0);
}
main();
