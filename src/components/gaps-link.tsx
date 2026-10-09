import Link from "next/link";
import { db } from "@/lib/db";
import { enqueuePrescan } from "@/lib/queue";

const STALE_MS = 30 * 60 * 1000;

/** The latest feed scan for this user; starts a rescan in the background when there is none or it is stale. */
async function gapsSummary(userId: string) {
  const [scan, gaps] = await Promise.all([db.feedScan.findUnique({ where: { userId } }), db.feedGap.count({ where: { userId } })]);
  if (!scan || Date.now() - scan.updatedAt.getTime() > STALE_MS) void enqueuePrescan(userId).catch(() => undefined);
  return { scan, gaps };
}

/** Feed header: how many questions would unblock the rest of the feed (T56). */
export async function GapsLink({ userId }: { userId: string }) {
  const { scan, gaps } = await gapsSummary(userId);
  if (!scan || gaps === 0) return null;
  const blocked = scan.scanned - scan.covered;
  return (
    <Link href="/gaps" className="text-xs font-medium text-primary underline-offset-4 hover:underline">
      Answer {gaps} {gaps === 1 ? "question" : "questions"} to unblock {blocked} {blocked === 1 ? "job" : "jobs"}
    </Link>
  );
}
