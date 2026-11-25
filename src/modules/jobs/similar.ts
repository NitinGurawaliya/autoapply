import { db } from "@/lib/db";
import { APPLY_BOARDS } from "./pool";

/**
 * Open jobs like one job (share links, Phase U6, docs/share/TDD.md §4.1 item 9): nearest by the posting's embedding
 * (semantic.ts), open, on a board the agent applies on, open to India, posted in the last 45 days, one per company and
 * never the job's own company. Used where a shared job can't be applied to: closed, a board the agent can't use, or
 * not a match. Empty when the job has no embedding.
 */

export type SimilarJob = { id: string; title: string; location: string; remoteType: string; company: { name: string; logoUrl: string | null } };

const WINDOW_DAYS = 45;

export async function similarJobs(jobId: string, n = 3): Promise<SimilarJob[]> {
  const rows = await db.$queryRaw<Array<{ id: string; title: string; location: string; remoteType: string; companyId: string; name: string; logoUrl: string | null }>>`
    WITH src AS (SELECT embedding, "companyId" FROM "Job" WHERE id = ${jobId} AND embedding IS NOT NULL)
    SELECT j.id, j.title, j.location, j."remoteType", j."companyId", c.name, c."logoUrl"
    FROM "Job" j
    JOIN "Company" c ON c.id = j."companyId"
    CROSS JOIN src
    WHERE j.id <> ${jobId}
      AND j."closedAt" IS NULL
      AND j.source = ANY(${[...APPLY_BOARDS]}::text[])
      AND j.eligibility IN ('india', 'remote_india')
      AND j."postedAt" > now() - make_interval(days => ${WINDOW_DAYS}::int)
      AND j."companyId" <> src."companyId"
      AND j.embedding IS NOT NULL
    ORDER BY j.embedding <=> src.embedding
    LIMIT ${n * 6}`;
  const seen = new Set<string>();
  const picked: SimilarJob[] = [];
  for (const row of rows) {
    if (seen.has(row.companyId)) continue;
    seen.add(row.companyId);
    picked.push({ id: row.id, title: row.title, location: row.location, remoteType: row.remoteType, company: { name: row.name, logoUrl: row.logoUrl } });
    if (picked.length === n) break;
  }
  return picked;
}
