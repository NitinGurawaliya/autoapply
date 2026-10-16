import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AutoRefresh } from "@/components/auto-refresh";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueuePrescan } from "@/lib/queue";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ProgressBar } from "@/components/ui/segmented-progress";
import { TitleTopBar } from "@/components/patterns/top-bar";
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
  if (!scan) after(() => enqueuePrescan(user.id).catch(() => undefined));
  const percent = scan && scan.scanned > 0 ? Math.round((scan.covered / scan.scanned) * 100) : null;

  return (
    <>
      <TitleTopBar
        title="Fill your gaps"
        sub="The questions your top feed jobs ask that we cannot answer from your resume or saved answers. Answer them once and those applications run without asking."
      />
      <div className="flex flex-col gap-5 px-5 pt-4 pb-6">
        {!scan ? (
          <div className="flex flex-col gap-3 rounded-panel bg-subtle p-4" aria-busy="true">
            <p className="m-0 text-[15px] font-semibold">Reading the application questions of your top jobs</p>
            <p className="m-0 text-sm text-muted-foreground">This takes a minute.</p>
            <div className="h-1.5 animate-pulse rounded-full bg-track" />
            <AutoRefresh active everyMs={5000} />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2.5 rounded-panel bg-subtle p-4">
              <Eyebrow>Ready to apply without asking</Eyebrow>
              <p className="m-0 font-display text-[44px] leading-none font-extrabold tracking-[-0.045em]">{percent === null ? "–" : `${percent}%`}</p>
              {percent !== null ? <ProgressBar value={percent} /> : null}
              <p className="m-0 text-sm leading-normal">
                {scan.scanned === 0
                  ? "None of your top jobs publish their questions yet; they will ask while applying."
                  : `${scan.covered} of ${scan.scanned} jobs in your feed can be answered in full right now.`}
              </p>
            </div>
            {gaps.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">Nothing missing. Every scanned job can be answered without asking you.</p>
            ) : (
              <section className="flex flex-col gap-2.5" aria-label="Missing answers">
                <Eyebrow as="h2">Missing answers · {gaps.length}</Eyebrow>
                <GapsForm gaps={gaps.map((gap) => ({ key: gap.key, label: gap.label, type: gap.type, options: optionsSchema.parse(gap.options), jobs: gap.jobs }))} />
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
