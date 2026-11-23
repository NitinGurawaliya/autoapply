-- Signed-in job sites (Phase K, docs/naukri/TDD.md 4.3): the user's own Naukri account. Additive only.
ALTER TABLE "WorkerBeat" ADD COLUMN "hasScreen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN "applyVia" TEXT;

CREATE TABLE "SiteConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stateKey" TEXT,
    "accountLabel" TEXT,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "connectedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastIngestAt" TIMESTAMP(3),
    "pausedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteConnection_userId_site_key" ON "SiteConnection"("userId", "site");
ALTER TABLE "SiteConnection" ADD CONSTRAINT "SiteConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SourceRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "searches" INTEGER NOT NULL DEFAULT 0,
    "pages" INTEGER NOT NULL DEFAULT 0,
    "listed" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "details" INTEGER NOT NULL DEFAULT 0,
    "stopReason" TEXT,
    "error" TEXT,
    CONSTRAINT "SourceRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SourceRun_userId_site_startedAt_idx" ON "SourceRun"("userId", "site", "startedAt");
