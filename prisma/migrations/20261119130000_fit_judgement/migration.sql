-- Phase P, P6 (docs/relevance/TDD.md 4.1 item 7, 4.3): the fit verdicts in their own table, so the old path keeps
-- JobJudgement untouched and flipping RELEVANCE_FIT re-judges nothing. JobJudgement gets its foreign keys (cascade)
-- after its orphans are deleted: only rows whose profile or job no longer exists (9,671 of 25,048 on 19 Nov).
CREATE TABLE "FitJudgement" (
  "profileId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "fitHash" TEXT NOT NULL,
  "jobHash" TEXT NOT NULL,
  "fit" TEXT NOT NULL,
  "why" TEXT NOT NULL,
  "evidenceIndex" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FitJudgement_pkey" PRIMARY KEY ("profileId", "jobId")
);
CREATE INDEX "FitJudgement_jobId_idx" ON "FitJudgement"("jobId");
ALTER TABLE "FitJudgement" ADD CONSTRAINT "FitJudgement_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FitJudgement" ADD CONSTRAINT "FitJudgement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DELETE FROM "JobJudgement" jj
WHERE NOT EXISTS (SELECT 1 FROM "Profile" p WHERE p.id = jj."profileId")
   OR NOT EXISTS (SELECT 1 FROM "Job" j WHERE j.id = jj."jobId");
CREATE INDEX "JobJudgement_jobId_idx" ON "JobJudgement"("jobId");
ALTER TABLE "JobJudgement" ADD CONSTRAINT "JobJudgement_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobJudgement" ADD CONSTRAINT "JobJudgement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
