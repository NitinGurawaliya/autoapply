-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "heartbeatAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SubmitLock" (
    "userId" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmitLock_pkey" PRIMARY KEY ("userId")
);
