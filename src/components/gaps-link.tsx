import { after } from "next/server";
import Link from "next/link";
import { Icon } from "@/components/ui/icons";
import { db } from "@/lib/db";
import { enqueuePrescan } from "@/lib/queue";

const STALE_MS = 30 * 60 * 1000;

/** The latest feed scan for this user; starts a rescan in the background when there is none or it is stale. */
async function gapsSummary(userId: string) {
  const [scan, gaps] = await Promise.all([db.feedScan.findUnique({ where: { userId } }), db.feedGap.count({ where: { userId } })]);
  if (!scan || Date.now() - scan.updatedAt.getTime() > STALE_MS) after(() => enqueuePrescan(userId).catch(() => undefined));
  return { scan, gaps };
}

/** Feed header: how many questions would unblock the rest of the feed (T56). */
export async function GapsLink({ userId }: { userId: string }) {
  // Not before the first swipe (Phase S, 21 Nov): a new user who just finished onboarding was met by "Your agent needs
  // 4 answers"; the agent asks on the form that needs an answer, and the line is for someone already applying.
  const [{ scan, gaps }, swiped] = await Promise.all([gapsSummary(userId), db.swipe.findFirst({ where: { userId }, select: { jobId: true } })]);
  if (!swiped || !scan || gaps === 0) return null;
  const blocked = scan.scanned - scan.covered;
  const sentence = `Your agent needs ${gaps} ${gaps === 1 ? "answer" : "answers"} to apply to ${blocked} more ${blocked === 1 ? "job" : "jobs"}`;
  // One line (the deck needs the height on short phones); the whole sentence is in the title.
  return (
    <Link
      href="/gaps"
      title={sentence}
      className="inline-flex min-h-8 max-w-full min-w-0 items-center gap-1.5 self-start type-meta font-semibold text-foreground underline decoration-1 underline-offset-4"
    >
      <Icon name="info" size={14} className="flex-none" />
      <span className="truncate">{sentence}</span>
    </Link>
  );
}
