import type { Job } from "pg-boss";
import { handleInbound, pruneStrangerMessages, type InboundMessage } from "@/modules/whatsapp";

/**
 * Phase Y, Y2: one inbound WhatsApp message (docs/whatsapp/TDD.md 4.2, 4.5). The link flow and the stranger reply; the log
 * line names the outcome only, never a number or a text.
 */
export async function handleWhatsAppInbound(jobs: Job<InboundMessage>[]) {
  for (const job of jobs) {
    if (!job.data?.wamid || !job.data.from) continue;
    const outcome = await handleInbound(job.data);
    console.log(`whatsapp inbound (${job.data.kind}): ${outcome}`);
  }
  // Messages from numbers nobody linked are kept 24 hours (TDD 4.3).
  await pruneStrangerMessages().catch(() => undefined);
}
