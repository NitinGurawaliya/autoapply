-- The model's verdict per resume and job (modules/jobs/semantic.ts judgeJobs).
CREATE TABLE "JobJudgement" (
    "profileId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fromHash" TEXT NOT NULL,
    "jobHash" TEXT NOT NULL,
    "fit" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobJudgement_pkey" PRIMARY KEY ("profileId","jobId")
);
