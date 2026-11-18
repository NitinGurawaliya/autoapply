-- Phase P, P2 (docs/relevance/TDD.md 4.3, 7.1): the evaluation's stored pools, the owner's labels and the eval's own
-- verdicts. Nothing in the feed reads them; deleteOldClosedJobs keeps jobs that are pooled or labelled.
CREATE TABLE "EvalPool" (
  "profileId" TEXT NOT NULL,
  "round" INTEGER NOT NULL,
  "jobId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvalPool_pkey" PRIMARY KEY ("profileId", "round", "jobId")
);
CREATE INDEX "EvalPool_jobId_idx" ON "EvalPool"("jobId");
ALTER TABLE "EvalPool" ADD CONSTRAINT "EvalPool_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvalPool" ADD CONSTRAINT "EvalPool_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FeedLabel" (
  "profileId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "relevant" BOOLEAN,
  "by" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "round" INTEGER NOT NULL,
  CONSTRAINT "FeedLabel_pkey" PRIMARY KEY ("profileId", "jobId")
);
CREATE INDEX "FeedLabel_jobId_idx" ON "FeedLabel"("jobId");
ALTER TABLE "FeedLabel" ADD CONSTRAINT "FeedLabel_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedLabel" ADD CONSTRAINT "FeedLabel_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EvalJudgement" (
  "profileId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "fromHash" TEXT NOT NULL,
  "jobHash" TEXT NOT NULL,
  "fit" TEXT NOT NULL,
  "why" TEXT NOT NULL,
  "evidence" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvalJudgement_pkey" PRIMARY KEY ("profileId", "jobId", "path")
);
CREATE INDEX "EvalJudgement_jobId_idx" ON "EvalJudgement"("jobId");
ALTER TABLE "EvalJudgement" ADD CONSTRAINT "EvalJudgement_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvalJudgement" ADD CONSTRAINT "EvalJudgement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
