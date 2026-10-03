-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "codeRequestId" TEXT,
ADD COLUMN     "codeRequestStatus" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "autoReadOtp" BOOLEAN NOT NULL DEFAULT false;
