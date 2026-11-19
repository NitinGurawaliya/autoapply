-- P8 (Phase P, docs/relevance/TDD.md 4.1 item 9): why a left swipe was made, and the job's family at that moment
-- (trackOf), so a later re-reading never moves an old skip. Additive only.
ALTER TABLE "Swipe" ADD COLUMN "reason" TEXT;
ALTER TABLE "Swipe" ADD COLUMN "family" TEXT;
