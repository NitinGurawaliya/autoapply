import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { z } from "zod";
import { db } from "@/lib/db";

/**
 * Which service answers the text calls (callJson): "openai" (default) or "gemini" (LLM_PROVIDER=gemini, 21 Nov), through
 * Gemini's OpenAI-compatible endpoint with GEMINI_API_KEY. Embeddings stay on OpenAI either way: every stored job and
 * profile vector is an OpenAI vector, and a Gemini vector cannot be compared with them.
 */
export type LlmProvider = "openai" | "gemini";
export function llmProvider(): LlmProvider {
  return process.env.LLM_PROVIDER?.trim().toLowerCase() === "gemini" ? "gemini" : "openai";
}

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const GEMINI_CHAT_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

/** The default text model: OPENAI_MODEL (gpt-4o-mini), or on Gemini GEMINI_MODEL (gemini-2.5-flash). */
export function defaultModel() {
  return llmProvider() === "gemini" ? process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash" : process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

/** The stronger model for judgement calls (fit.ts): GEMINI_FIT_MODEL (gemini-2.5-pro) on Gemini, else FIT_MODEL. */
export function strongModel(): string | null {
  return llmProvider() === "gemini" ? process.env.GEMINI_FIT_MODEL?.trim() || "gemini-2.5-pro" : process.env.FIT_MODEL?.trim() || null;
}

/** A model name the provider can serve: on Gemini an OpenAI name (gpt-…, o1…) a caller passed becomes the default. */
function modelFor(requested: string | undefined) {
  const name = requested?.trim();
  if (!name) return defaultModel();
  if (llmProvider() === "gemini" && /^(gpt-|o\d)/i.test(name)) return defaultModel();
  return name;
}

const memory = new Map<string, unknown>();

function loadEnvKey(name: "OPENAI_API_KEY" | "GEMINI_API_KEY") {
  if (process.env[name]) return;
  let text = "";
  try {
    text = readFileSync(".env", "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    let value = trimmed.slice(name.length + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) process.env[name] = value;
  }
}

function stripFences(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

async function writeFieldLabel(source: string, label: string, key: string) {
  const labelHash = createHash("sha256").update(label).digest("hex");
  await db.fieldMappingCache.upsert({
    where: { source_labelHash: { source, labelHash } },
    create: { source, labelHash, key },
    update: { key },
  });
}

/** Which queue a call waits in: background batches (reading, skills labels, judging, fit) are capped per process at
 * LLM_BACKGROUND_CONCURRENT; interactive calls (field mapping, guesses, essays during an apply run) never wait behind
 * them (docs/relevance/TDD.md 4.1.3). */
export type LlmLane = "background" | "interactive";
type CallOptions = { lane?: LlmLane; timeoutMs?: number };

const TRIES = 4;
const MAX_WAIT_MS = 30_000;

function envInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

let backgroundRunning = 0;
const backgroundWaiting: Array<() => void> = [];

async function inLane<T>(lane: LlmLane, run: () => Promise<T>): Promise<T> {
  if (lane !== "background") return run();
  const cap = envInt("LLM_BACKGROUND_CONCURRENT", 6);
  // A finishing call hands its slot straight to the next waiter, so a new caller can never slip in between.
  if (backgroundRunning >= cap) await new Promise<void>((resolve) => backgroundWaiting.push(resolve));
  else backgroundRunning += 1;
  try {
    return await run();
  } finally {
    const next = backgroundWaiting.shift();
    if (next) next();
    else backgroundRunning -= 1;
  }
}

/** Tokens spent by this process since it started (scripts print cost per 1,000 jobs from it). */
export const llmUsage = { calls: 0, input: 0, output: 0 };

/** How long to wait before the next try: the server's Retry-After when it gives one, else 1 s, 2 s, 4 s with jitter. */
function waitMs(response: Response | null, attempt: number) {
  const header = response?.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    if (Number.isFinite(ms) && ms >= 0) return Math.min(MAX_WAIT_MS, ms);
  }
  return Math.min(MAX_WAIT_MS, 1000 * 2 ** attempt + Math.floor(Math.random() * 250));
}

/**
 * POST JSON to OpenAI or Gemini (`provider`) with a per-try timeout, retrying a 429, a 5xx, a timeout or a network error
 * at most TRIES times. Any other error status is returned as is for the caller to report.
 */
async function postJson(url: string, payload: unknown, options: CallOptions, provider: LlmProvider = "openai") {
  const keyName = provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
  loadEnvKey(keyName);
  const apiKey = process.env[keyName];
  if (!apiKey) throw new Error(`${keyName} is not set`);
  const timeoutMs = options.timeoutMs ?? envInt("LLM_TIMEOUT_MS", 60_000);
  return inLane(options.lane ?? "interactive", async () => {
    let lastError = "";
    for (let attempt = 0; attempt < TRIES; attempt += 1) {
      let response: Response | null = null;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status !== 429 && response.status < 500) return response;
        lastError = `status ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.name === "TimeoutError" ? `timeout after ${timeoutMs} ms` : error.message : "fetch failed";
      }
      if (attempt < TRIES - 1) {
        const wait = waitMs(response, attempt);
        console.log(`llm retry attempt=${attempt + 1} reason="${lastError}" waitMs=${wait}`);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    throw new Error(`${provider === "gemini" ? "Gemini" : "OpenAI"} request failed after ${TRIES} tries (${lastError})`);
  });
}

async function complete(system: string, user: string, requested?: string, options: CallOptions = {}) {
  const started = Date.now();
  const provider = llmProvider();
  const model = modelFor(requested);
  const response = await postJson(
    provider === "gemini" ? GEMINI_CHAT_URL : OPENAI_CHAT_URL,
    {
      model,
      temperature: 0,
      // Gemini's endpoint is held to JSON by the prompt (callJson's system line) and the schema check, not by
      // response_format; OpenAI keeps its JSON mode.
      ...(provider === "openai" ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    options,
    provider,
  );
  const latencyMs = Date.now() - started;
  const body = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `${provider === "gemini" ? "Gemini" : "OpenAI"} request failed (${response.status})`);
  }
  llmUsage.calls += 1;
  llmUsage.input += body.usage?.prompt_tokens ?? 0;
  llmUsage.output += body.usage?.completion_tokens ?? 0;
  console.log(
    `llm tokens model=${model} input=${body.usage?.prompt_tokens ?? 0} output=${body.usage?.completion_tokens ?? 0} latencyMs=${latencyMs}`,
  );
  return body.choices?.[0]?.message?.content ?? "";
}

export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * One vector per text, in order. Used to find a user's past questions that mean the same thing (modules/answers), and
 * to match resumes with jobs by meaning (modules/jobs/semantic.ts, 512 dimensions).
 */
export async function embed(texts: string[], options?: { dimensions?: number; lane?: LlmLane }): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  // The API takes many inputs per call; keep batches modest.
  for (let start = 0; start < texts.length; start += 256) {
    const batch = texts.slice(start, start + 256);
    const started = Date.now();
    const response = await postJson(
      "https://api.openai.com/v1/embeddings",
      { model: EMBEDDING_MODEL, input: batch, dimensions: options?.dimensions ?? EMBEDDING_DIMENSIONS },
      { lane: options?.lane },
    );
    const body = (await response.json()) as {
      error?: { message?: string };
      data?: Array<{ index: number; embedding: number[] }>;
      usage?: { prompt_tokens?: number };
    };
    if (!response.ok || !body.data) throw new Error(body.error?.message ?? `OpenAI embeddings failed (${response.status})`);
    console.log(`llm embed inputs=${batch.length} tokens=${body.usage?.prompt_tokens ?? 0} latencyMs=${Date.now() - started}`);
    for (const item of [...body.data].sort((a, b) => a.index - b.index)) out.push(item.embedding);
  }
  return out;
}

export async function callJson<T>(
  schema: z.ZodType<T>,
  system: string,
  user: string,
  options?: { cacheKey?: string; fieldLabel?: { source: string; label: string }; model?: string } & CallOptions,
): Promise<T> {
  if (options?.cacheKey && memory.has(options.cacheKey)) {
    console.log(`llm cache hit ${options.cacheKey}`);
    return memory.get(options.cacheKey) as T;
  }

  const jsonSystem = `${system}\n\nRespond with one JSON object only. Do not use markdown fences.`;
  let lastError = "invalid json";
  let parsed: T | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = attempt === 0 ? user : `${user}\n\nThe previous response failed validation: ${lastError}`;
    const raw = stripFences(await complete(jsonSystem, prompt, options?.model, { lane: options?.lane, timeoutMs: options?.timeoutMs }));
    try {
      parsed = schema.parse(JSON.parse(raw));
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "invalid json";
      parsed = null;
    }
  }

  if (parsed === null) {
    throw new Error(`callJson failed validation: ${lastError}`);
  }

  if (options?.cacheKey) memory.set(options.cacheKey, parsed);

  if (options?.fieldLabel && parsed && typeof parsed === "object" && "key" in parsed) {
    const key = (parsed as { key?: unknown }).key;
    if (typeof key === "string") {
      await writeFieldLabel(options.fieldLabel.source, options.fieldLabel.label, key);
    }
  }

  return parsed;
}
