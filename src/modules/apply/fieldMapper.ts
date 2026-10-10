import { createHash } from "node:crypto";
import { z } from "zod";
import { callJson } from "@/lib/llm";
import { db } from "@/lib/db";
import { ANSWER_KEYS, getAnswerKey, matchKeyBySynonym } from "@/modules/answers";
import type { FormField } from "./adapter";

const keySchema = z.object({
  key: z.string(),
});

// Keys the agent asks for itself (one-time permissions, the standing sponsorship answer, the saved best-project
// story): a form's own question is never one of them, whatever its words ("Coinbase may use AI tools" is a notice,
// not the user's permission to draft essays).
const AGENT_KEYS = new Set(["accept_acknowledgements", "accept_ai_essays", "essay_best_project", "sponsorship_outside_home"]);
const TEXT_TYPES = new Set(["text", "long_text"]);

/** Whether a key picked by the model (now or in the cache) can be this field's key. */
function fits(field: FormField, key: string | null) {
  const def = key ? getAnswerKey(key) : null;
  if (!def || AGENT_KEYS.has(def.key)) return false;
  // A tick box holds yes/no: a text fact such as the current job title cannot go in it ("Current role" in work history).
  if (field.type === "checkbox" && TEXT_TYPES.has(def.type)) return false;
  return true;
}

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
    if (field.hintKey && getAnswerKey(field.hintKey)) {
      mapped.push({ field, key: field.hintKey });
      continue;
    }
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
    if (cached && fits(field, cached)) {
      mapped.push({ field, key: cached });
      continue;
    }
    try {
      const parsed = await callJson(
        keySchema,
        `Map a job application form label to one canonical answer key. Keys: ${ANSWER_KEYS.filter((def) => !AGENT_KEYS.has(def.key)).map((def) => def.key).join(", ")}. ` +
          'Only pick a key when the label asks for exactly that fact about the candidate. Yes/no questions about specific skills, offices, past employment at this company or consent are "unknown". ' +
          'Return JSON {"key":"<key>"} or {"key":"unknown"}.',
        field.label,
        { cacheKey: `field:${source}:${field.label}`, fieldLabel: { source, label: field.label } },
      );
      mapped.push({ field, key: fits(field, parsed.key) ? parsed.key : null });
    } catch {
      mapped.push({ field, key: null });
    }
  }
  return mapped;
}
