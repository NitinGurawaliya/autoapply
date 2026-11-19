-- Phase P, P7 (docs/relevance/TDD.md 4.1 item 8): the daily set. One row per user per India day
-- ((now() AT TIME ZONE 'Asia/Kolkata')::date), built by the first request, prescan or warm with INSERT ... ON CONFLICT
-- DO NOTHING; jobIds is the day's ranked set (DAILY_SET_SIZE), released how many of it the deck may show (advanced by
-- compare-and-set, PATCH /api/daily-set), basis the hash of what built it (a change rebuilds the set), pushedAt the
-- day's one "Today's set is ready" push. Additive only.
CREATE TABLE "DailySet" (
  "userId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "jobIds" TEXT[] NOT NULL,
  "released" INTEGER NOT NULL DEFAULT 4,
  "basis" TEXT NOT NULL,
  "pushedAt" TIMESTAMP(3),
  "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailySet_pkey" PRIMARY KEY ("userId", "day")
);
ALTER TABLE "DailySet" ADD CONSTRAINT "DailySet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
