
import OpenAI from "openai";
import { Buffer } from "node:buffer";

const MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4o";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;

  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  client = new OpenAI({ apiKey });
  return client;
}

export async function analyzeTestImage(
  image: Buffer,
): Promise<string> {
  if (!Buffer.isBuffer(image) || image.length === 0) {
    throw new Error("Invalid or empty image buffer");
  }

  const base64 = image.toString("base64");

  const response = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${base64}`,
              detail: "high",
            },
          },
          {
            type: "text",
            text: "I need you to look at the image that I'm sending, extract the text, and return only the text, nothing else. ",
          },
        ],
      },
    ],
  });

  const result = response.choices[0]?.message?.content;

  if (!result) {
    throw new Error("OpenAI returned an empty response");
  }

  return result;
}
