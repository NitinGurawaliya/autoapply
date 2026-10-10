import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { forgetFeed } from "@/lib/feed-cache";
import type { AnswerContext } from "./memory";
import { getAnswerKey } from "./keys";
import { isCustomQuestionKey } from "./questionKey";

const SOURCES = ["resume", "user", "ai_draft", "default"] as const;

export type AnswerSource = (typeof SOURCES)[number];

export async function getAll(userId: string) {
  return db.answer.findMany({ where: { userId }, orderBy: { key: "asc" } });
}

export async function get(userId: string, key: string) {
  return db.answer.findUnique({ where: { userId_key: { userId, key } } });
}

export async function remove(userId: string, key: string) {
  const result = await db.answer.deleteMany({ where: { userId, key } });
  if (key === "preferred_location") forgetFeed(userId);
  return result.count > 0;
}

export async function upsert(
  userId: string,
  input: { key: string; question: string; answer: string; source: AnswerSource; context?: AnswerContext | null },
) {
  const def = getAnswerKey(input.key);
  const custom = isCustomQuestionKey(input.key);
  if (!def && !custom) throw new Error(`Unknown answer key: ${input.key}`);
  if (!SOURCES.includes(input.source)) throw new Error(`Unknown answer source: ${input.source}`);
  if (input.source === "ai_draft" && def?.policy !== "ai_draft_ok") {
    throw new Error(`Key ${input.key} cannot be ai_draft`);
  }

  // The embedding is refreshed lazily (memory.ensureEmbeddings) when the wording changes, so a save stays one query.
  const context = input.context ? (input.context as Prisma.InputJsonValue) : Prisma.DbNull;
  const data = { question: input.question, answer: input.answer, source: input.source, context };
  // Preferred locations score the feed's location points.
  if (input.key === "preferred_location") forgetFeed(userId);
  return db.answer.upsert({
    where: { userId_key: { userId, key: input.key } },
    create: { userId, key: input.key, ...data },
    update: data,
  });
}
