import { redirect } from "next/navigation";
import { z } from "zod";
import { AutoRefresh } from "@/components/auto-refresh";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueuePrescan } from "@/lib/queue";
import { GapsForm } from "./gaps-form";

// The few facts still missing for the user's top feed jobs (modules/apply/prescan.ts), ranked by how many jobs each one
// blocks. Answering them here means those applications run without asking anything.
const optionsSchema = z.array(z.string()).nullable().catch(null);

export default async function GapsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const [scan, gaps] = await Promise.all([
    db.feedScan.findUnique({ where: { userId: user.id } }),
    db.feedGap.findMany({ where: { userId: user.id }, orderBy: [{ jobs: "desc" }, { label: "asc" }] }),
  ]);
  if (!scan) void enqueuePrescan(user.id).catch(() => undefined);
  const percent = scan && scan.scanned > 0 ? Math.round((scan.covered / scan.scanned) * 100) : null;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fill your gaps</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The questions your top feed jobs ask that we cannot answer from your resume or saved answers. Answer them once and those applications run without asking.
        </p>
      </div>

      {!scan ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-card" aria-busy="true">
          Reading the application questions of your top jobs. This takes a minute.
          <AutoRefresh active everyMs={5000} />
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
            <p className="text-3xl font-semibold tracking-tight">{percent === null ? "–" : `${percent}%`}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {scan.scanned === 0
                ? "None of your top jobs publish their questions yet; they will ask while applying."
                : `${scan.covered} of ${scan.scanned} jobs in your feed can be answered in full right now.`}
            </p>
          </div>
          {gaps.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing missing. Every scanned job can be answered without asking you.</p>
          ) : (
            <GapsForm gaps={gaps.map((gap) => ({ key: gap.key, label: gap.label, type: gap.type, options: optionsSchema.parse(gap.options), jobs: gap.jobs }))} />
          )}
        </>
      )}
    </>
  );
}
