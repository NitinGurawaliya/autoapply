-- Phase U7 (docs/share/TDD.md 4.2): the share-link funnel, one row per visitor, job and step.
CREATE TABLE "FunnelEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "step" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT,
    "jobId" TEXT NOT NULL,
    "source" TEXT,
    "detail" TEXT,

    CONSTRAINT "FunnelEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FunnelEvent_visitorId_jobId_step_key" ON "FunnelEvent"("visitorId", "jobId", "step");
CREATE INDEX "FunnelEvent_at_step_idx" ON "FunnelEvent"("at", "step");
CREATE INDEX "FunnelEvent_detail_idx" ON "FunnelEvent"("detail");

ALTER TABLE "FunnelEvent" ADD CONSTRAINT "FunnelEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
