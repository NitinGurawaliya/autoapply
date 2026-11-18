-- Phase P, P1 (docs/relevance/TDD.md 4.1.2): each job is read once by the model (modules/jobs/reading.ts): its field
-- (roleFamily), kind, flags, and verified evidence and requirement lines. A reading stays current until the job's title
-- or description really changes; the trigger checks the values, because ingest rewrites both columns on every changed
-- job (a moved location or a new updated_at must not stale a reading).
ALTER TABLE "Job"
  ADD COLUMN "roleFamily" TEXT,
  ADD COLUMN "kind" TEXT,
  ADD COLUMN "flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "reading" JSONB,
  ADD COLUMN "readingCurrent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "readAt" TIMESTAMP(3),
  ADD COLUMN "readFailedAt" TIMESTAMP(3),
  ADD COLUMN "readAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "readClaimedUntil" TIMESTAMP(3);

CREATE FUNCTION job_reading_stale() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."title" IS DISTINCT FROM OLD."title" OR NEW."description" IS DISTINCT FROM OLD."description" THEN
    NEW."readingCurrent" := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER job_reading_stale BEFORE INSERT OR UPDATE OF "title", "description" ON "Job"
  FOR EACH ROW EXECUTE FUNCTION job_reading_stale();
