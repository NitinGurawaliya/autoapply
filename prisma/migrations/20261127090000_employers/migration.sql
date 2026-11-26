-- Phase W, W1: employers above board accounts (docs/employers/TDD.md 4.3). Applied with prisma migrate deploy only.
CREATE TABLE "Employer" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameBasis" TEXT,
    "domain" TEXT,
    "domainBasis" TEXT,
    "logoUrl" TEXT,
    "stage" TEXT,
    "openJobs" INTEGER NOT NULL DEFAULT 0,
    "openIndia" INTEGER NOT NULL DEFAULT 0,
    "nameKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Employer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Employer_slug_key" ON "Employer"("slug");
CREATE UNIQUE INDEX "Employer_domain_key" ON "Employer"("domain");
CREATE INDEX "Employer_nameKey_openJobs_idx" ON "Employer"("nameKey", "openJobs");
CREATE INDEX "Employer_openIndia_idx" ON "Employer"("openIndia");

CREATE TABLE "EmployerAlias" (
    "slug" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployerAlias_pkey" PRIMARY KEY ("slug")
);
CREATE INDEX "EmployerAlias_employerId_idx" ON "EmployerAlias"("employerId");
ALTER TABLE "EmployerAlias" ADD CONSTRAINT "EmployerAlias_employerId_fkey"
    FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Company" ADD COLUMN "employerId" TEXT;
ALTER TABLE "Company" ADD COLUMN "domain" TEXT;
ALTER TABLE "Company" ADD COLUMN "domainBasis" TEXT;
ALTER TABLE "Company" ADD COLUMN "domainCheckedAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "linkedAt" TIMESTAMP(3);
CREATE INDEX "Company_employerId_idx" ON "Company"("employerId");
ALTER TABLE "Company" ADD CONSTRAINT "Company_employerId_fkey"
    FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Job_companyId_closedAt_idx" ON "Job"("companyId", "closedAt");
