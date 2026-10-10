-- The company type the feed filters on (prisma/companies.ts): startup, midsize or mnc; null = not tagged yet.
ALTER TABLE "Company" ADD COLUMN "stage" TEXT;
