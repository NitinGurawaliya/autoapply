import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { z } from "zod";

// Claude (Anthropic) counterpart of lib/llm.ts: text in, text or Zod-validated JSON out. Reads ANTHROPIC_API_KEY
// (from the environment, else .env). ANTHROPIC_MODEL overrides the model.
const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
// Opus 5.5's default effort is medium; set per call with `effort`.
type Effort = "low" | "medium" | "high" | "xhigh" | "max";
type Options = { model?: string; effort?: Effort; maxTokens?: number };

const memory = new Map<string, unknown>();
let client: Anthropic | null = null;

function loadEnvKey() {
  if (process.env.ANTHROPIC_API_KEY) return;
  let text = "";
  try {
    text = readFileSync(".env", "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("ANTHROPIC_API_KEY=")) continue;
    let value = trimmed.slice("ANTHROPIC_API_KEY=".length).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value) process.env.ANTHROPIC_API_KEY = value;
  }
}

function anthropic() {
  if (client) return client;
  loadEnvKey();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  client = new Anthropic();
  return client;
}

function stripFences(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/** One request to Claude: a system prompt and a user message in, the reply's text out. */
export async function callClaude(system: string, user: string, options: Options = {}): Promise<string> {
  const started = Date.now();
  // A declined request is re-run on a fallback model inside the same call (server-side fallback, "default" routing).
  const params = {
    model: options.model?.trim() || MODEL,
    max_tokens: options.maxTokens ?? 16000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: options.effort ?? "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
  const response = await anthropic().beta.messages.create(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
  console.log(`claude tokens input=${response.usage.input_tokens} output=${response.usage.output_tokens} latencyMs=${Date.now() - started}`);
  if (response.stop_reason === "refusal") throw new Error("Claude declined the request");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off at max_tokens");
  return response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

let openai: OpenAI | null = null;

/**
 * The same text call on OpenAI, through its SDK: a system prompt and a user message in, the reply's text out.
 * Reads OPENAI_API_KEY; OPENAI_MODEL overrides the model, as in lib/llm.ts.
 */
export async function callOpenAI(system: string, user: string, options: { model?: string; maxTokens?: number } = {}): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  openai ??= new OpenAI();
  const started = Date.now();
  const response = await openai.chat.completions.create({
    model: options.model?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    max_completion_tokens: options.maxTokens ?? 4000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  console.log(`openai tokens input=${response.usage?.prompt_tokens ?? 0} output=${response.usage?.completion_tokens ?? 0} latencyMs=${Date.now() - started}`);
  const choice = response.choices[0];
  if (choice?.finish_reason === "length") throw new Error("OpenAI's answer was cut off at max_tokens");
  return (choice?.message.content ?? "").trim();
}

/** As lib/llm.ts callJson: JSON-only answer, parsed and checked with the schema, asked once more if it does not fit. */
export async function callClaudeJson<T>(schema: z.ZodType<T>, system: string, user: string, options: Options & { cacheKey?: string } = {}): Promise<T> {
  if (options.cacheKey && memory.has(options.cacheKey)) return memory.get(options.cacheKey) as T;

  const jsonSystem = `${system}\n\nRespond with one JSON object only. Do not use markdown fences.`;
  let lastError = "invalid json";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = attempt === 0 ? user : `${user}\n\nThe previous response failed validation: ${lastError}`;
    const raw = stripFences(await callClaude(jsonSystem, prompt, options));
    try {
      const parsed = schema.parse(JSON.parse(raw));
      if (options.cacheKey) memory.set(options.cacheKey, parsed);
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "invalid json";
    }
  }
  throw new Error(`callClaudeJson failed validation: ${lastError}`);
}
