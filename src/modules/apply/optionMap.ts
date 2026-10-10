import { z } from "zod";
import { callJson } from "@/lib/llm";
import { numericRange, optionKey, type UnfitAnswer } from "./valueResolver";

/**
 * Re-word a known answer onto a form's own options when the deterministic fit (exact, prefix, number range) fails:
 * "30 days" → "1 month", "Yes, I am authorized" → "Authorized", "Man" → "Male". One call per form; the model may only
 * pick one of the options it was shown, or none, and for sensitive and EEO answers only an option that says the same
 * thing. Anything it cannot place is still asked.
 */

const mapSchema = z.object({
  results: z.array(z.object({ index: z.number().int(), option: z.string().nullable(), reason: z.string().max(300) })),
});

const SYSTEM = `An applicant already answered a question, but the application form only accepts one of its listed options.
For each item pick the ONE option that means the same as the applicant's answer to that question, copied exactly as listed, or null when no option means the same.
- Re-word only; never change the fact. "30 days" may become "1 month" or "4 weeks", "Yes, I am authorized" may become "Authorized", "Man" may become "Male", and a number belongs to the one range that contains it ("12 LPA" is in "10-15 LPA").
- When "sensitive" is true (pay, notice period, work authorization, sponsorship, relocation, residence, demographic questions), pick an option only if it says the same thing or is the one range containing the answer; when in doubt, null. Never "Other" for a sensitive item.
- When "sensitive" is false and the answer names something none of the options names (an event, a site, a person), pick the option for anything else ("Other", "Something else") if the form lists one; if it lists none, null.
- Never pick an option just because it is the closest or the default.
Return {"results":[{"index","option","reason"}]}.`;

const cache = new Map<string, string | null>();
const cacheKey = (item: UnfitAnswer) => `${item.answer}\u0000${item.options.join("\u0001")}\u0000${item.sensitive}`;

/** Map each unfit answer onto one of its field's options; returns optionKey(label, answer) → option. */
export async function mapToOptions(items: UnfitAnswer[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const todo = items.filter((item) => item.options.length > 0 && item.options.length <= 60 && item.answer.trim());
  // A number in exactly one range of the same unit is arithmetic, not a judgement: no model needed.
  for (const item of todo) {
    const range = cache.has(cacheKey(item)) ? undefined : numericRange(item.answer, item.options);
    if (range) cache.set(cacheKey(item), range);
  }
  const ask = todo.filter((item) => !cache.has(cacheKey(item)));
  if (ask.length > 0) {
    const payload = ask.map((item, index) => ({ index, question: item.label.slice(0, 300), answer: item.answer.slice(0, 300), options: item.options, sensitive: item.sensitive }));
    const verdict = await callJson(mapSchema, SYSTEM, JSON.stringify({ items: payload }));
    for (const [index, item] of ask.entries()) {
      const option = verdict.results.find((result) => result.index === index)?.option ?? null;
      // Only an option that is really on the form counts.
      cache.set(cacheKey(item), option && item.options.includes(option) ? option : null);
    }
  }
  for (const item of todo) {
    const option = cache.get(cacheKey(item));
    if (option) out.set(optionKey(item.label, item.answer), option);
  }
  return out;
}
