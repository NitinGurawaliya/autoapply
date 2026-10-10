-- Meaning-based matching of resumes and jobs (modules/jobs/semantic.ts). pgvector is already installed.
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "Job" ADD COLUMN "embedding" halfvec(512);
ALTER TABLE "Profile" ADD COLUMN "embedding" halfvec(512);
ALTER TABLE "Profile" ADD COLUMN "embeddedFrom" TEXT;
