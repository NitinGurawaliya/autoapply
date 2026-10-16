-- How close the work is (same | close | related | different): related jobs are another field, shown only on request.
ALTER TABLE "JobJudgement" ADD COLUMN "field" TEXT;
