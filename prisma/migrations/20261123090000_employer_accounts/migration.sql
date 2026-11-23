-- Phase V, V1: the user's application password and their employer accounts (docs/accounts/TDD.md 4.3).
ALTER TABLE "User" ADD COLUMN "applicationSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "applicationSecretAt" TIMESTAMP(3);

CREATE TABLE "EmployerAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "employer" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "secret" TEXT,
    "state" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "EmployerAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployerAccount_userId_system_employer_key" ON "EmployerAccount"("userId", "system", "employer");

ALTER TABLE "EmployerAccount" ADD CONSTRAINT "EmployerAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
