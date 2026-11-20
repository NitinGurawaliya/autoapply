-- Phase R (docs/reveal/TDD.md 4.2): what the agent did for the day's set, and when its reveal was seen.
ALTER TABLE "DailySet" ADD COLUMN "stats" JSONB, ADD COLUMN "revealedAt" TIMESTAMP(3);
