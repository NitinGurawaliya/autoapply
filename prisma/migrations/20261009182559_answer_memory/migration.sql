-- pgvector (Neon supports it): question embeddings for the answer memory.
CREATE EXTENSION IF NOT EXISTS vector;

-- AlterTable
ALTER TABLE "Answer" ADD COLUMN     "context" JSONB,
ADD COLUMN     "embeddedHash" TEXT,
ADD COLUMN     "embedding" vector(1536);

-- CreateTable
CREATE TABLE "LabelEmbedding" (
    "labelHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabelEmbedding_pkey" PRIMARY KEY ("labelHash")
);
