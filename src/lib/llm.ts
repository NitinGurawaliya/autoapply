import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { z } from "zod";
import { db } from "@/lib/db";

const MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

const memory = new Map<string, unknown>();

function loadEnvKey() {
  if (process.env.OPENAI_API_KEY) return;
  let text = "";
  try {
    text = readFileSync(".env", "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("OPENAI_API_KEY=")) continue;
    let value = trimmed.slice("OPENAI_API_KEY=".length).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) process.env.OPENAI_API_KEY = value;
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

async function complete(system: string, user: string) {
  loadEnvKey();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const latencyMs = Date.now() - started;
  const body = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `OpenAI request failed (${response.status})`);
  }
  console.log(
    `llm tokens input=${body.usage?.prompt_tokens ?? 0} output=${body.usage?.completion_tokens ?? 0} latencyMs=${latencyMs}`,
  );
  return body.choices?.[0]?.message?.content ?? "";
}

export async function callJson<T>(
  schema: z.ZodType<T>,
  system: string,
  user: string,
  options?: { cacheKey?: string; fieldLabel?: { source: string; label: string } },
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
    const raw = stripFences(await complete(jsonSystem, prompt));
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
