-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "questions" JSONB,
ADD COLUMN     "questionsFetchedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FeedScan" (
    "userId" TEXT NOT NULL,
    "scanned" INTEGER NOT NULL,
    "covered" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedScan_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "FeedGap" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB,
    "jobs" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedGap_pkey" PRIMARY KEY ("userId","key")
);
