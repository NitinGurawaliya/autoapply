// T51: embed every saved answer's question for the answer memory (pgvector). Safe to re-run: only answers with no
// embedding, or whose wording changed since, are embedded; wordings already seen by anyone come from the shared cache.
// Answers saved before T51 have no job context, so they are never reused for company/city/country-specific questions.
// npx tsx scripts/backfill-embeddings.ts
import { db } from "../src/lib/db";
import { ensureEmbeddings } from "../src/modules/answers";

async function main() {
  const users = await db.answer.groupBy({ by: ["userId"], _count: true });
  let embedded = 0;
  for (const { userId, _count } of users) {
    const count = await ensureEmbeddings(userId);
    embedded += count;
    console.log(`user …${userId.slice(-6)}: ${_count} answers, ${count} embedded now`);
  }
  const [left] = await db.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "Answer" WHERE length(trim("question")) > 0 AND ("embedding" IS NULL OR "embeddedHash" IS DISTINCT FROM md5("question"))`;
  console.log(`embedded ${embedded} answers; still without an embedding: ${left.n}`);
  console.log(left.n === 0 ? "PASS backfill-embeddings" : "FAIL backfill-embeddings");
  process.exit(left.n === 0 ? 0 : 1);
}

main().finally(() => db.$disconnect());
