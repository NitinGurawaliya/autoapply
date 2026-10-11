-- Companies switched off automatically, discovery that runs itself, and the worker's heartbeat.
ALTER TABLE "Company" ADD COLUMN "failedFetches" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Company" ADD COLUMN "emptySince" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "offReason" TEXT;
ALTER TABLE "Company" ADD COLUMN "addedBy" TEXT NOT NULL DEFAULT 'seed';
ALTER TABLE "Company" ADD COLUMN "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "DiscoveryCandidate" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'greenhouse',
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "stage" TEXT,
    "from" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "openJobs" INTEGER NOT NULL DEFAULT 0,
    "indiaJobs" INTEGER NOT NULL DEFAULT 0,
    "freshIndiaJobs" INTEGER NOT NULL DEFAULT 0,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscoveryCandidate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DiscoveryCandidate_source_name_key" ON "DiscoveryCandidate"("source", "name");

CREATE TABLE "WorkerBeat" (
    "id" TEXT NOT NULL,
    "beatAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkerBeat_pkey" PRIMARY KEY ("id")
);
