-- The feed matches skills in Postgres instead of downloading every description (modules/jobs/match.ts): each job keeps
-- the distinct words of its title and description, lower-cased and split exactly as scoreJob's skill matcher splits
-- them. A trigger keeps them current on every insert and on every change of title or description.
ALTER TABLE "Job" ADD COLUMN "terms" TEXT[];

CREATE FUNCTION job_terms() RETURNS trigger AS $$
BEGIN
  NEW."terms" := ARRAY(
    SELECT DISTINCT term
    FROM unnest(regexp_split_to_array(lower(NEW."title" || chr(10) || NEW."description"), '[^a-z0-9+#]+')) AS term
    WHERE term <> ''
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER job_terms BEFORE INSERT OR UPDATE OF "title", "description" ON "Job"
  FOR EACH ROW EXECUTE FUNCTION job_terms();

-- Existing jobs: touching the title fires the trigger.
UPDATE "Job" SET "title" = "title";
