import { db } from "../src/lib/db";
async function main() {
  const id = process.argv[2];
  const app = await db.application.findUnique({ where: { id }, select: { status: true, error: true } });
  const ev = await db.applicationEvent.findMany({ where: { applicationId: id, createdAt: { gt: new Date(Date.now() - 20 * 60 * 1000) } }, orderBy: { createdAt: "asc" }, select: { createdAt: true, type: true, message: true } });
  console.log(`STATUS ${app?.status} ${app?.error ?? ""}`);
  for (const e of ev.filter((x) => x.type !== "fill")) console.log(e.createdAt.toISOString().slice(11, 19), e.type, (e.message ?? "").slice(0, 180));
  await db.$disconnect();
}
main();
