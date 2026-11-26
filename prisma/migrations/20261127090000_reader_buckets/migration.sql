-- K14 (docs/naukri/TDD.md 13.17): the shared reader of a job site. Additive only: two new tables, nothing else touched.
CREATE TABLE "ReaderBucket" (
    "id" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'search',
    "keyword" TEXT NOT NULL,
    "location" TEXT,
    "experience" INTEGER,
    "users" INTEGER NOT NULL DEFAULT 0,
    "everyHours" INTEGER NOT NULL DEFAULT 24,
    "nextReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3),
    "claimedUntil" TIMESTAMP(3),
    "lastStop" TEXT,
    "lastListed" INTEGER,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReaderBucket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReaderBucket_site_key_key" ON "ReaderBucket"("site", "key");
CREATE INDEX "ReaderBucket_site_active_nextReadAt_idx" ON "ReaderBucket"("site", "active", "nextReadAt");

CREATE TABLE "ReaderRun" (
    "id" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "reader" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "buckets" INTEGER NOT NULL DEFAULT 0,
    "pages" INTEGER NOT NULL DEFAULT 0,
    "listed" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "details" INTEGER NOT NULL DEFAULT 0,
    "stopReason" TEXT,
    "error" TEXT,
    CONSTRAINT "ReaderRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReaderRun_site_startedAt_idx" ON "ReaderRun"("site", "startedAt");
