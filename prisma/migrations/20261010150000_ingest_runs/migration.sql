-- Ingest at hundreds of companies (T79). A job is written only when its content changed: contentHash covers the
-- fields ingest stores and tags from. A company whose board fails keeps the error. Each run is one IngestRun row:
-- an unfinished one stops a second run from overlapping it, and its counts are the daily freshness numbers (T84).
ALTER TABLE "Job" ADD COLUMN "contentHash" TEXT;
ALTER TABLE "Company" ADD COLUMN "lastError" TEXT;

CREATE TABLE "IngestRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "companies" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "closed" INTEGER NOT NULL DEFAULT 0,
    "deleted" INTEGER NOT NULL DEFAULT 0,
    "createdEligible" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "IngestRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IngestRun_startedAt_idx" ON "IngestRun"("startedAt");
