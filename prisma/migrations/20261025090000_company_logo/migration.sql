-- Company logos from their public job board pages (modules/jobs/logos.ts).
ALTER TABLE "Company" ADD COLUMN "logoUrl" TEXT;
ALTER TABLE "Company" ADD COLUMN "logoCheckedAt" TIMESTAMP(3);
