import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../src/lib/db";
import { callJson } from "../src/lib/llm";
import { storage } from "../src/lib/storage";

const SMOKE_EMAIL = "infra-smoke@swipeapply.local";
const CONTENT_TYPE = "application/octet-stream";

async function main() {
  const user = await db.user.upsert({
    where: { email: SMOKE_EMAIL },
    update: {},
    create: { email: SMOKE_EMAIL, name: "Infra smoke" },
  });

  const bytes = new Uint8Array(1024);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256;
  const key = `resumes/${user.id}/smoke.bin`;
  await storage.put(key, bytes, CONTENT_TYPE, user.id);
  console.log(`put ${key} bytes=${bytes.byteLength}`);

  const session = await db.session.create({
    data: {
      sessionToken: randomUUID(),
      userId: user.id,
      expires: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  try {
    const url = `http://localhost:3000${storage.url(key)}`;
    const anonymous = await fetch(url);
    console.log(`anonymous status=${anonymous.status}`);

    const response = await fetch(url, {
      headers: { cookie: `authjs.session-token=${session.sessionToken}` },
    });
    const body = new Uint8Array(await response.arrayBuffer());
    const type = response.headers.get("content-type");
    const same =
      body.byteLength === bytes.byteLength && body.every((value, index) => value === bytes[index]);
    console.log(`GET status=${response.status} content-type=${type} bytes=${body.byteLength} match=${same}`);
    if (anonymous.status !== 401 || response.status !== 200 || type !== CONTENT_TYPE || !same) {
      throw new Error("file check failed");
    }

    const place = z.object({ city: z.string().min(1), country: z.string().min(1) });
    const cacheKey = "infra-smoke-bengaluru";
    const first = await callJson(
      place,
      "Extract the city and country where this person lives.",
      "I live in Bengaluru",
      { cacheKey },
    );
    console.log(`callJson ${JSON.stringify(first)}`);
    const second = await callJson(
      place,
      "Extract the city and country where this person lives.",
      "I live in Bengaluru",
      { cacheKey },
    );
    if (second.city !== first.city || second.country !== first.country) {
      throw new Error("cache returned a different value");
    }
    console.log("PASS");
  } finally {
    await db.session.delete({ where: { sessionToken: session.sessionToken } }).catch(() => undefined);
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "smoke failed");
  console.log("FAIL");
  process.exit(1);
});
