
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

// One read took 40 s on 21 Nov: a slow read is dropped and the next image read instead.
const READ_TIMEOUT_MS = 20000;

/** An error that no new image fixes (no key, a refused key, no credit): the form goes to a person instead. */
export function modelUnavailable(error: unknown) {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const status = (error as { status?: number } | null)?.status;
  return status === 401 || status === 403 || /OPENAI_API_KEY|insufficient_quota|billing|Incorrect API key/i.test(text);
}

/**
 * An image CAPTCHA's characters, read for a board whose form the worker submits (Zoho Recruit, 21 Nov). Stricter than
 * analyzeTestImage (Keka's, unchanged): the model is told to answer with the characters alone, and its answer is
 * cleaned (quotes, spaces, a lead-in like "The text is:" dropped) and kept only when it is letters and digits within
 * `minLength`..`maxLength`. `length`, when the board's CAPTCHA always has that many characters: the model is told so,
 * and any other length is refused (a read one character short or long is wrong, and a new image costs a second where a
 * refused CAPTCHA costs filling the whole form again). Anything refused is null: the caller loads a new image and reads
 * again, never submits it. A missing key or an API error throws, so the caller can hand the form to a person instead.
 */
export async function readCaptcha(
  image: Buffer,
  options: { minLength?: number; maxLength?: number; length?: number } = {},
): Promise<string | null> {
  if (!Buffer.isBuffer(image) || image.length === 0) return null;
  const minLength = options.length ?? options.minLength ?? 4;
  const maxLength = options.length ?? options.maxLength ?? 10;
  const count = options.length ? ` It has exactly ${options.length} characters.` : "";

  const response = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 20,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You transcribe the characters shown in a distorted text image. Reply with the characters only, exactly as shown, preserving upper and lower case, with no spaces, quotes, punctuation or explanation. If the image shows no readable characters, reply with NONE.",
      },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${image.toString("base64")}`, detail: "high" } },
          { type: "text", text: `The characters in this image:${count}` },
        ],
      },
    ],
  }, { timeout: READ_TIMEOUT_MS, maxRetries: 0 });

  return cleanCaptchaText(response.choices[0]?.message?.content ?? "", minLength, maxLength);
}

/** The model's reply → the characters to type, or null when it is not a plausible CAPTCHA answer. */
export function cleanCaptchaText(reply: string, minLength = 4, maxLength = 10): string | null {
  let text = reply.trim();
  // A lead-in the model sometimes adds ("The text is: ab12C", "Answer - ab12C"): the part after its colon or dash.
  const lead = text.match(/^(?:the\s+)?(?:text|characters|captcha|answer)[^:\-]*[:\-]\s*(.+)$/i);
  if (lead) text = lead[1];
  text = text.replace(/[`"'‘’“”.]/g, "").replace(/\s+/g, "");
  if (/^none$/i.test(text)) return null;
  if (!/^[A-Za-z0-9]+$/.test(text)) return null;
  if (text.length < minLength || text.length > maxLength) return null;
  return text;
}
