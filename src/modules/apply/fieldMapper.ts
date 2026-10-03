import { createHash } from "node:crypto";
import { z } from "zod";
import { callJson } from "@/lib/llm";
import { db } from "@/lib/db";
import { ANSWER_KEYS, getAnswerKey, matchKeyBySynonym } from "@/modules/answers";
import type { FormField } from "./adapter";

const keySchema = z.object({
  key: z.string(),
});

async function cachedKey(source: string, label: string) {
  const labelHash = createHash("sha256").update(label).digest("hex");
  const row = await db.fieldMappingCache.findUnique({
    where: { source_labelHash: { source, labelHash } },
  });
  return row?.key ?? null;
}

export async function mapFields(source: string, fields: FormField[]) {
  const mapped: Array<{ field: FormField; key: string | null }> = [];
  for (const field of fields) {
    const id = field.selector.match(/^#(.+)$|^\[id="(.+)"\]$/)?.slice(1).find(Boolean) ?? field.selector;
    if (getAnswerKey(id)) {
      mapped.push({ field, key: id });
      continue;
    }
    const synonym = matchKeyBySynonym(field.label);
    if (synonym) {
      mapped.push({ field, key: synonym });
      continue;
    }
    const cached = await cachedKey(source, field.label);
    if (cached && getAnswerKey(cached)) {
      mapped.push({ field, key: cached });
      continue;
    }
    try {
      const parsed = await callJson(
        keySchema,
        `Map a job application form label to one canonical answer key. Keys: ${ANSWER_KEYS.map((def) => def.key).join(", ")}. ` +
          'Only pick a key when the label asks for exactly that fact about the candidate. Yes/no questions about specific skills, offices, past employment at this company or consent are "unknown". ' +
          'Return JSON {"key":"<key>"} or {"key":"unknown"}.',
        field.label,
        { cacheKey: `field:${source}:${field.label}`, fieldLabel: { source, label: field.label } },
      );
      mapped.push({ field, key: getAnswerKey(parsed.key) ? parsed.key : null });
    } catch {
      mapped.push({ field, key: null });
    }
  }
  return mapped;
}
