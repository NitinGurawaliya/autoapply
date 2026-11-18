-- Phase M (docs/job-match/TDD.md §4.3): a job's tech skills (vocabulary terms the posting names), the ones the model
-- labelled required, and pay from the board's structured fields. All additive; existing rows get empty lists / nulls.
ALTER TABLE "Job" ADD COLUMN "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Job" ADD COLUMN "skillsRequired" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Job" ADD COLUMN "skillsHash" TEXT;
ALTER TABLE "Job" ADD COLUMN "salaryMin" INTEGER;
ALTER TABLE "Job" ADD COLUMN "salaryMax" INTEGER;
ALTER TABLE "Job" ADD COLUMN "salaryCurrency" TEXT;
ALTER TABLE "Job" ADD COLUMN "salaryPeriod" TEXT;
