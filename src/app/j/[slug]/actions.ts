"use server";

import { redirect } from "next/navigation";
import { getCurrentUser, signIn } from "@/lib/auth";
import { jobPath } from "@/lib/job-slug";
import { setShareIntent } from "@/lib/share-intent";
import { shareLinksEnabled } from "@/lib/share-gate";
import { publicJob } from "@/modules/jobs";
import { trackShareStep } from "@/modules/share";

/**
 * Apply on a share page (Phase U4, docs/share/TDD.md §4.3 steps 2–3). The tap is remembered (the intent cookie), then:
 * signed out, straight to Google's account chooser, back to this job afterwards; signed in without a profile, to the
 * resume step; with a profile, back to the job, which hands it to the agent (U5).
 */
export async function applyFromShare(jobId: string) {
  const job = shareLinksEnabled() ? await publicJob(jobId) : null;
  if (!job) redirect("/");
  const path = jobPath(job);
  if (job.closedAt || !job.applyable) redirect(path);

  await setShareIntent(job.id);
  const user = await getCurrentUser();
  await trackShareStep("apply_tap", { jobId: job.id, userId: user?.id ?? null });
  if (!user) await signIn("google", { redirectTo: path });
  else if (!user.hasProfile) redirect("/onboarding/resume");
  redirect(path);
}
