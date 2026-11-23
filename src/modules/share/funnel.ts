import { after } from "next/server";
import { track, type FunnelStep } from "@/lib/funnel";
import { readShareIntent } from "@/lib/share-intent";
import { visitorId } from "@/lib/visitor";

/**
 * Records a share-link funnel step from a web request (Phase U7), after the response: the visitor from the `sa_vid`
 * cookie, the job given or else the share intent's. Nothing is recorded without a job, so onboarding without a share
 * link writes no rows.
 */
export async function trackShareStep(step: FunnelStep, context: { jobId?: string | null; userId?: string | null; source?: string | null; detail?: string | null } = {}) {
  const [visitor, intent] = await Promise.all([visitorId(), context.jobId ? Promise.resolve(null) : readShareIntent()]);
  const jobId = context.jobId ?? intent;
  if (!jobId) return;
  after(() => track(step, { jobId, visitorId: visitor, userId: context.userId ?? null, source: context.source ?? null, detail: context.detail ?? null }));
}
