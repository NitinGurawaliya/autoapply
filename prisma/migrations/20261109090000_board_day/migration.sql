-- Phase M, M1: one row per board per UTC day (modules/jobs/boardDay.ts).
CREATE TABLE "BoardDay" (
    "day" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "companies" INTEGER NOT NULL,
    "active" INTEGER NOT NULL,
    "open" INTEGER NOT NULL,
    "empty" INTEGER NOT NULL,
    "dead" INTEGER NOT NULL,
    "openIndia" INTEGER NOT NULL,
    "openIndiaTech" INTEGER NOT NULL,
    "openIndiaEntry" INTEGER NOT NULL,
    "newIndia" INTEGER NOT NULL,
    "swipesRight" INTEGER NOT NULL,
    "submitted" INTEGER NOT NULL,
    "writtenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardDay_pkey" PRIMARY KEY ("day","source")
);
