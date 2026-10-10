-- Whether a candidate in India can take the job (modules/jobs/tagging.ts eligibility): india, remote_india, abroad or
-- unknown. The feed shows india and remote_india only.
ALTER TABLE "Job" ADD COLUMN "eligibility" TEXT NOT NULL DEFAULT 'unknown';
CREATE INDEX "Job_source_eligibility_postedAt_idx" ON "Job"("source", "eligibility", "postedAt");

-- When we first saw the job (for "new for you today"). Jobs already stored count as seen when they were posted.
ALTER TABLE "Job" ADD COLUMN "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Job" SET "firstSeenAt" = "postedAt";
