import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { embed, EMBEDDING_MODEL } from "@/lib/llm";

/**
 * Answer memory: every saved answer's question is embedded (pgvector, same database), so a new wording on a form can
 * find the user's past questions that mean the same. Recall only RETRIEVES candidates; deciding that a candidate truly
 * answers the new question (same company, city, country, skill) is the verify step's job (modules/apply/recall.ts).
 * The vector column is invisible to Prisma, so everything here is raw SQL.
 */

/** Below this cosine score a past question is never offered as a candidate. From the T49 experiment on real wordings:
 *  the lowest true paraphrase scored 0.599, so 0.54 keeps every one of them with a margin. */
export const RECALL_MIN_SCORE = 0.54;
export const RECALL_LIMIT = 5;

export type AnswerContext = { company?: string; title?: string; location?: string; country?: string };

export type Recalled = {
  id: string;
  key: string;
  question: string;
  answer: string;
  source: string;
  context: AnswerContext | null;
  score: number;
  updatedAt: Date;
};

const clean = (label: string) => label.replace(/\s+/g, " ").trim();
const labelHash = (label: string) => createHash("sha256").update(clean(label).toLowerCase()).digest("hex");
const literal = (vector: number[]) => `[${vector.join(",")}]`;

/** Vectors for these wordings, from the shared cache; only wordings never seen before are sent to the embeddings API. */
export async function labelVectors(labels: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(labels.map(clean).filter(Boolean))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const hashes = wanted.map(labelHash);
  const cached = await db.$queryRaw<Array<{ labelHash: string; vector: string }>>`
    SELECT "labelHash", "embedding"::text AS "vector" FROM "LabelEmbedding" WHERE "labelHash" = ANY(${hashes})`;
  const byHash = new Map(cached.map((row) => [row.labelHash, row.vector]));
  const missing = wanted.filter((label) => !byHash.has(labelHash(label)));
  if (missing.length > 0) {
    const vectors = await embed(missing);
    for (const [index, label] of missing.entries()) {
      const vector = literal(vectors[index]);
      byHash.set(labelHash(label), vector);
      await db.$executeRaw`
        INSERT INTO "LabelEmbedding" ("labelHash", "label", "embedding", "model")
        VALUES (${labelHash(label)}, ${label}, ${vector}::vector, ${EMBEDDING_MODEL})
        ON CONFLICT ("labelHash") DO NOTHING`;
    }
  }
  for (const label of wanted) out.set(label, byHash.get(labelHash(label))!);
  return out;
}

/** Embeds this user's answers whose wording has no embedding yet or changed since it was embedded. Returns how many. */
export async function ensureEmbeddings(userId: string) {
  const stale = await db.$queryRaw<Array<{ id: string; question: string }>>`
    SELECT "id", "question" FROM "Answer"
    WHERE "userId" = ${userId} AND length(trim("question")) > 0
      AND ("embedding" IS NULL OR "embeddedHash" IS DISTINCT FROM md5("question"))`;
  if (stale.length === 0) return 0;
  const vectors = await labelVectors(stale.map((row) => row.question));
  for (const row of stale) {
    const vector = vectors.get(clean(row.question));
    if (!vector) continue;
    await db.$executeRaw`UPDATE "Answer" SET "embedding" = ${vector}::vector, "embeddedHash" = md5("question") WHERE "id" = ${row.id}`;
  }
  return stale.length;
}

/** For each label, the user's closest past questions and their answers (best first, score >= RECALL_MIN_SCORE). */
export async function recall(userId: string, labels: string[], options: { limit?: number; minScore?: number; excludeKeys?: string[] } = {}) {
  const limit = options.limit ?? RECALL_LIMIT;
  const minScore = options.minScore ?? RECALL_MIN_SCORE;
  // Standing permissions (accept_*) are not answers to a question, so they are never offered as candidates.
  const exclude = options.excludeKeys ?? [];
  const out = new Map<string, Recalled[]>();
  if (labels.length === 0) return out;
  await ensureEmbeddings(userId);
  const vectors = await labelVectors(labels);
  await Promise.all(
    labels.map(async (label) => {
      const vector = vectors.get(clean(label));
      if (!vector) return out.set(label, []);
      const rows = await db.$queryRaw<Array<Omit<Recalled, "score"> & { score: number }>>`
        SELECT "id", "key", "question", "answer", "source", "context", "updatedAt", 1 - ("embedding" <=> ${vector}::vector) AS "score"
        FROM "Answer"
        WHERE "userId" = ${userId} AND "embedding" IS NOT NULL AND "key" NOT LIKE 'accept\\_%' AND NOT ("key" = ANY(${exclude}))
        ORDER BY "embedding" <=> ${vector}::vector
        LIMIT ${limit}`;
      out.set(
        label,
        rows.filter((row) => Number(row.score) >= minScore).map((row) => ({ ...row, score: Number(row.score), context: (row.context as AnswerContext | null) ?? null })),
      );
    }),
  );
  return out;
}
