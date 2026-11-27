"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, signIn } from "@/lib/auth";
import { db } from "@/lib/db";
import { applyToAll } from "@/modules/apply/lifecycle";
import { loadRules } from "@/modules/governance";
import { employerFits } from "@/modules/jobs/browse";

export type ApplyAllState = { sent: number; held: number; skipped: number; message: string } | null;

/** Why the rest wait, in the app's words. */
function heldLine(held: number, rule: string | null) {
  const jobs = `${held} more ${held === 1 ? "fits" : "fit"}`;
  if (rule === "max_per_company_per_week") return `${jobs}: your agent applies to at most ${loadRules().max_per_company_per_week} jobs a week at one company, so it can send ${held === 1 ? "it" : "them"} next week.`;
  if (rule === "max_applications_per_day") return `${jobs}: that's today's limit, so ${held === 1 ? "it waits" : "they wait"} for tomorrow.`;
  if (rule === "max_in_flight") return `${jobs}: your agent is busy with the ones already on the way. Try again in a while.`;
  return `${jobs}.`;
}

/**
 * Apply to all that fit (Phase X, X5, docs/feed/TDD.md 4.5): every job at this employer that matches the person's profile
 * and they haven't applied to, best first, through applyToAll (each a right swipe with every check and event). Signed
 * out: Google, then back to the page; no profile: the resume step.
 */
export async function applyToMatching(slug: string): Promise<ApplyAllState> {
  const page = `/companies/${slug}`;
  const user = await getCurrentUser();
  if (!user) await signIn("google", { redirectTo: page });
  if (!user) return null;
  if (!user.hasProfile) redirect("/onboarding/resume");
  const employer = /^[a-z0-9-]{2,60}$/.test(slug) ? await db.employer.findUnique({ where: { slug }, select: { id: true } }) : null;
  if (!employer) return { sent: 0, held: 0, skipped: 0, message: "This company has no open jobs now." };
  const fits = await employerFits(user.id, employer.id);
  const matching = [...fits.entries()].filter(([, fit]) => fit.matches).sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0));
  const decided = new Set(
    (await db.swipe.findMany({ where: { userId: user.id, direction: "right", jobId: { in: matching.map(([id]) => id) } }, select: { jobId: true } })).map((swipe) => swipe.jobId),
  );
  const ids = matching.map(([id]) => id).filter((id) => !decided.has(id));
  if (ids.length === 0) return { sent: 0, held: 0, skipped: 0, message: "You've applied to every job here that fits." };
  const result = await applyToAll(user.id, ids);
  revalidatePath(page);
  const lines = [
    result.sent.length > 0 ? `${result.sent.length} sent to your agent.` : "None sent now.",
    result.held > 0 ? heldLine(result.held, result.heldBy) : null,
    result.skipped > 0 ? `${result.skipped} ${result.skipped === 1 ? "was" : "were"} not sent: see Applications for why.` : null,
  ];
  return { sent: result.sent.length, held: result.held, skipped: result.skipped, message: lines.filter(Boolean).join(" ") };
}
