-- The feed looks each of the candidate's skills up in this index (modules/jobs/match.ts feedRows) instead of reading
-- every job's word list once per skill.
CREATE INDEX "Job_terms_idx" ON "Job" USING GIN ("terms");
