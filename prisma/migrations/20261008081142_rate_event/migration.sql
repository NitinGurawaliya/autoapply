-- CreateTable
CREATE TABLE "RateEvent" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateEvent_key_createdAt_idx" ON "RateEvent"("key", "createdAt");
