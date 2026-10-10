-- T81: what kind of job each posting is, and the candidate's tracks.
ALTER TABLE "Job" ADD COLUMN "function" TEXT;
ALTER TABLE "Job" ADD COLUMN "track" TEXT;
ALTER TABLE "Job" ADD COLUMN "seniority" TEXT;
CREATE INDEX "Job_track_idx" ON "Job"("track");
ALTER TABLE "Profile" ADD COLUMN "tracks" TEXT[] DEFAULT ARRAY[]::TEXT[];
