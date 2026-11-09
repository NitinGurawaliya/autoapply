-- Phase M, M2: every company watched at its own pace (modules/jobs/cadence.ts), India-only storage for new companies.
ALTER TABLE "Company" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "Company" ADD COLUMN "nextFetchAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Company" ADD COLUMN "indiaOpen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Company" ADD COLUMN "notFoundFetches" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Company" ADD COLUMN "lastIndiaAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "listHash" TEXT;
ALTER TABLE "Company" ADD COLUMN "keepAbroad" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Company_active_nextFetchAt_idx" ON "Company"("active", "nextFetchAt");

-- The Greenhouse and Lever companies watched before Phase M keep their jobs abroad (owner, 9 Nov).
UPDATE "Company" SET "keepAbroad" = true WHERE source IN ('greenhouse', 'lever');

-- Start every company from what it lists now, so the first ticks place it in the right tier.
UPDATE "Company" c SET "indiaOpen" = s.n, "lastIndiaAt" = s.last
FROM (
  SELECT "companyId", COUNT(*) FILTER (WHERE "closedAt" IS NULL) AS n, MAX("firstSeenAt") AS last
  FROM "Job" WHERE eligibility IN ('india', 'remote_india') GROUP BY "companyId"
) s
WHERE s."companyId" = c.id;
