-- CreateTable
CREATE TABLE "MockSubmission" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockSubmission_pkey" PRIMARY KEY ("id")
);
