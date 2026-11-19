-- Phase P, P5 (docs/relevance/TDD.md 4.1 item 6): what the agent knows about the candidate for judging fit, built by
-- code from the profile (modules/profile/brief.ts) in its own table, so a rebuild never touches Profile.updatedAt.
-- fitHash = md5(FIT_VERSION + the exact brief JSON); learned lines sit beside it, outside the hash (P8);
-- fitBuildUntil is the one-build-per-user lease of P6. Never contact data.
CREATE TABLE "CandidateBrief" (
  "userId" TEXT NOT NULL,
  "brief" JSONB NOT NULL,
  "fitHash" TEXT NOT NULL,
  "learned" JSONB NOT NULL DEFAULT '[]',
  "fitBuildUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CandidateBrief_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "CandidateBrief" ADD CONSTRAINT "CandidateBrief_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
