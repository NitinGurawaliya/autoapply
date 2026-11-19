-- Phase P, P4 (docs/relevance/TDD.md 4.1 item 5): the confirm screen's "Also show nearby fields" (adjacent tracks
-- join the feed's tracks) and "Never show me" (contract, intern, commission_only; the gate in modules/jobs/gate.ts).
-- Settings on the profile, never answers.
ALTER TABLE "Profile"
  ADD COLUMN "showNearby" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "avoid" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
