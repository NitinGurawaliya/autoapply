import { receiveWebhook, verifyChallenge } from "@/modules/whatsapp";

// Phase Y, Y2 (docs/whatsapp/TDD.md 4.5, 4.9, 6): Meta's webhook. Answers only 200 or 403. The body is read as text, never
// parsed first: the HMAC is over the raw bytes. Switched off (WHATSAPP_ENABLED unset) a POST is answered 200 and dropped.
export const dynamic = "force-dynamic";

/** The one-time check when the webhook is saved in Meta's dashboard: works before the switch is on, so it can be saved first. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const challenge = verifyChallenge({ mode: params.get("hub.mode"), token: params.get("hub.verify_token"), challenge: params.get("hub.challenge") });
  if (challenge === null) return new Response("Forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: Request) {
  let status: 200 | 403 = 200;
  try {
    status = await receiveWebhook(await request.text(), request.headers.get("x-hub-signature-256"));
  } catch {
    // Anything that goes wrong after the signature is ours to deal with, not Meta's to retry for hours.
    console.warn("whatsapp webhook: not handled");
  }
  return new Response(status === 200 ? "ok" : "Forbidden", { status });
}
